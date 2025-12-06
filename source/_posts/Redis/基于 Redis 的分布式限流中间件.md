---
title: 基于 Redis 的分布式限流中间件
tags:
categories:
  - Redis
date: 2025-12-06 21:18:21
---

### 基于 Redis 的分布式限流中间件（解决 Koa 集群限流失效问题）
在集群部署场景下，单机内存版限流中间件会因各节点独立维护令牌桶导致限流规则失效（如集群3节点，单节点限流100次/分钟，实际总限流300次/分钟）。基于 Redis 的分布式限流通过**共享令牌桶状态** + **Lua 原子脚本** 解决该问题，保证集群所有节点的限流规则统一。

## 一、核心设计思路
1. **令牌桶算法迁移到 Redis**：用 Redis Hash 存储令牌桶状态（令牌数、最后补充时间），所有节点共享同一状态；
2. **Lua 脚本保证原子性**：补充令牌 + 消耗令牌的操作在 Redis 端原子执行，避免多节点并发操作导致的令牌数不一致；
3. **Redis 连接池**：使用 ioredis 连接池，适配高并发场景；
4. **容错处理**：Redis 连接失败时降级为单机限流（避免服务不可用）；
5. **过期清理**：为 Redis 键设置过期时间，避免内存溢出。

## 二、实现步骤（完整代码）
### 1. 安装依赖
```bash
npm install ioredis koa # ioredis 支持Promise/连接池/Lua脚本
```

### 2. 分布式限流中间件代码（企业级规范）
```javascript
/**
 * 基于Redis的分布式令牌桶限流中间件（src/middleware/redisRateLimit.js）
 * 特性：集群共享令牌桶、Lua原子操作、Redis降级、白名单、过期清理
 */
const Redis = require('ioredis');

class RedisTokenBucketRateLimit {
  /**
   * 构造函数
   * @param {Object} options 配置项
   * @param {Object} options.redis Redis连接配置（host/port/password/db）
   * @param {number} options.capacity 令牌桶最大容量（默认100）
   * @param {number} options.refillRate 令牌补充速率（个/秒，默认10）
   * @param {string} options.limitKey 限流维度（ip/userId，默认ip）
   * @param {Array} options.whiteList 白名单（IP/用户ID，默认[]）
   * @param {string} options.errorMsg 限流提示（默认"请求过于频繁，请稍后再试"）
   * @param {number} options.keyExpire 令牌桶Redis键过期时间（秒，默认3600）
   */
  constructor(options = {}) {
    // 合并默认配置
    this.options = {
      redis: {
        host: 'localhost',
        port: 6379,
        password: '',
        db: 0,
        connectTimeout: 5000 // 连接超时时间
      },
      capacity: 100,
      refillRate: 10,
      limitKey: 'ip',
      whiteList: [],
      errorMsg: '请求过于频繁，请稍后再试',
      keyExpire: 3600,
      ...options
    };

    // 初始化Redis客户端（连接池）
    this.redis = new Redis({
      ...this.options.redis,
      retryStrategy: (times) => {
        // 重试策略：失败后重试，间隔递增（避免频繁重试）
        const delay = Math.min(times * 100, 3000);
        return delay;
      }
    });

    // 监听Redis连接错误
    this.redis.on('error', (err) => {
      console.error('[Redis限流中间件] 连接失败，降级为单机限流:', err.message);
      this.redisAvailable = false;
      // 初始化单机令牌桶（降级方案）
      this.localBuckets = new Map();
      this.startLocalRefillTimer();
    });

    this.redis.on('connect', () => {
      console.log('[Redis限流中间件] Redis连接成功');
      this.redisAvailable = true;
    });

    // Lua脚本：原子执行「补充令牌 + 消耗令牌」（核心！）
    this.luaScript = `
      -- 获取配置参数
      local capacity = tonumber(ARGV[1])
      local refillRate = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])
      local keyExpire = tonumber(ARGV[4])

      -- 获取令牌桶当前状态（hash: {tokens, lastRefillTime}）
      local bucket = redis.call('HMGET', KEYS[1], 'tokens', 'lastRefillTime')
      local tokens = tonumber(bucket[1]) or capacity -- 初始令牌=桶容量
      local lastRefillTime = tonumber(bucket[2]) or now -- 初始时间=当前时间

      -- 计算自上次补充的时间差（秒）
      local timeDiff = math.max(0, now - lastRefillTime) / 1000
      -- 补充令牌（不超过桶容量）
      tokens = math.min(capacity, tokens + timeDiff * refillRate)

      -- 尝试消耗1个令牌
      local allowed = 1
      if tokens >= 1 then
        tokens = tokens - 1
        allowed = 1
      else
        allowed = 0
      end

      -- 更新令牌桶状态到Redis，并设置过期时间
      redis.call('HMSET', KEYS[1], 'tokens', tokens, 'lastRefillTime', now)
      redis.call('EXPIRE', KEYS[1], keyExpire)

      -- 返回结果：是否允许请求、剩余令牌数
      return {allowed, tokens}
    `;

    // 加载Lua脚本到Redis（缓存脚本SHA1，避免重复传输）
    this.scriptSha = null;
    this.loadLuaScript();
  }

  /**
   * 加载Lua脚本到Redis，获取脚本SHA1值
   */
  async loadLuaScript() {
    if (!this.redisAvailable) return;
    try {
      this.scriptSha = await this.redis.script('LOAD', this.luaScript);
    } catch (err) {
      console.error('[Redis限流中间件] 加载Lua脚本失败:', err.message);
    }
  }

  /**
   * 获取限流维度的Key（IP/用户ID）
   * @param {Object} ctx Koa上下文
   * @returns {string} 限流Key
   */
  getLimitKey(ctx) {
    let key;
    if (this.options.limitKey === 'ip') {
      key = ctx.ip;
    } else if (this.options.limitKey === 'userId') {
      // 假设用户ID存储在ctx.state.user.id（需提前通过鉴权中间件设置）
      key = ctx.state.user?.id || ctx.ip;
    }
    // 拼接前缀，避免Redis键冲突
    return `rate_limit:${this.options.limitKey}:${key}`;
  }

  /**
   * Redis版本：尝试消耗令牌（原子操作）
   * @param {string} key 限流Key
   * @returns {Promise<boolean>} 是否允许请求
   */
  async tryConsumeRedis(key) {
    if (!this.redisAvailable || !this.scriptSha) {
      return this.tryConsumeLocal(key); // 降级为单机限流
    }

    try {
      // 执行Lua脚本（KEYS: [限流Key]，ARGV: [容量, 速率, 当前时间, 过期时间]）
      const [allowed] = await this.redis.evalsha(
        this.scriptSha,
        1, // KEYS数组长度
        key,
        this.options.capacity,
        this.options.refillRate,
        Date.now(),
        this.options.keyExpire
      );
      return allowed === 1;
    } catch (err) {
      console.error('[Redis限流中间件] 执行Lua脚本失败，降级为单机限流:', err.message);
      return this.tryConsumeLocal(key);
    }
  }

  /**
   * 单机降级版本：尝试消耗令牌（同之前的单机逻辑）
   * @param {string} key 限流Key
   * @returns {boolean} 是否允许请求
   */
  tryConsumeLocal(key) {
    // 初始化单机令牌桶
    if (!this.localBuckets.has(key)) {
      this.localBuckets.set(key, {
        tokens: this.options.capacity,
        lastRefillTime: Date.now()
      });
    }
    const bucket = this.localBuckets.get(key);
    // 补充令牌
    const timeDiff = (Date.now() - bucket.lastRefillTime) / 1000;
    bucket.tokens = Math.min(this.options.capacity, bucket.tokens + timeDiff * this.options.refillRate);
    bucket.lastRefillTime = Date.now();
    // 消耗令牌
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * 单机版本：定时补充令牌（每秒执行）
   */
  startLocalRefillTimer() {
    if (this.localRefillTimer) return;
    this.localRefillTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of this.localBuckets) {
        const timeDiff = (now - bucket.lastRefillTime) / 1000;
        bucket.tokens = Math.min(this.options.capacity, bucket.tokens + timeDiff * this.options.refillRate);
        bucket.lastRefillTime = now;
      }
    }, 1000);
  }

  /**
   * 中间件核心逻辑
   * @returns {Function} Koa中间件
   */
  middleware() {
    return async (ctx, next) => {
      // 1. 获取限流Key
      const limitKey = this.getLimitKey(ctx);

      // 2. 白名单跳过限流
      const rawKey = limitKey.replace(`rate_limit:${this.options.limitKey}:`, '');
      if (this.options.whiteList.includes(rawKey)) {
        await next();
        return;
      }

      // 3. 尝试消耗令牌
      const allowed = await this.tryConsumeRedis(limitKey);
      if (!allowed) {
        ctx.status = 429; // 429 Too Many Requests
        ctx.body = {
          code: 429,
          msg: this.options.errorMsg,
          data: null
        };
        return;
      }

      // 4. 允许请求，执行后续逻辑
      await next();
    };
  }

  /**
   * 关闭Redis连接（应用退出时调用）
   */
  close() {
    if (this.redis) {
      this.redis.quit();
    }
    if (this.localRefillTimer) {
      clearInterval(this.localRefillTimer);
    }
  }
}

// 导出便捷使用的函数
module.exports = (options) => {
  const rateLimit = new RedisTokenBucketRateLimit(options);
  // 应用退出时关闭连接（防止内存泄漏）
  process.on('exit', () => rateLimit.close());
  return rateLimit.middleware();
};
```

### 3. 使用示例（集群部署下的 Koa 应用）
```javascript
/**
 * 入口文件（src/app.js）
 * 集群部署场景：多节点共享Redis限流规则
 */
const Koa = require('koa');
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;
const redisRateLimit = require('./middleware/redisRateLimit');

// 集群主进程：启动多个工作进程
if (cluster.isPrimary) {
  console.log(`主进程 ${process.pid} 启动`);
  // 启动与CPU核心数相同的工作进程
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  // 工作进程退出时重启
  cluster.on('exit', (worker) => {
    console.log(`工作进程 ${worker.process.pid} 退出，重启中...`);
    cluster.fork();
  });
} else {
  // 工作进程：创建Koa应用
  const app = new Koa();

  // 注册分布式限流中间件（全局限流，也可按模块注册）
  app.use(redisRateLimit({
    redis: {
      host: '192.168.1.100', // 集群Redis地址（建议用Redis集群/哨兵）
      port: 6379,
      password: 'your-redis-password',
      db: 1
    },
    capacity: 50, // 令牌桶容量50
    refillRate: 5, // 每秒补充5个令牌
    limitKey: 'userId', // 按用户ID限流
    whiteList: ['admin_123'], // 管理员用户ID白名单
    keyExpire: 1800 // Redis键30分钟过期
  }));

  // 测试接口
  app.use(async (ctx) => {
    if (ctx.path === '/api/order/create') {
      // 模拟设置用户ID（实际需从Token解析）
      ctx.state.user = { id: 'user_456' };
      ctx.body = {
        code: 200,
        msg: '订单创建成功',
        data: { orderId: `order_${Date.now()}` }
      };
    }
  });

  // 启动工作进程
  const PORT = 3000 + (process.pid % numCPUs); // 每个进程占用不同端口（或用反向代理）
  app.listen(PORT, () => {
    console.log(`工作进程 ${process.pid} 启动，监听端口 ${PORT}`);
  });
}
```

## 三、核心要点说明
### 1. Lua 脚本的必要性
Redis 是单线程执行 Lua 脚本，确保「补充令牌 + 消耗令牌」的操作原子化，避免集群多节点并发操作时：
- 节点A读取令牌数=1，节点B同时读取令牌数=1；
- 两节点都消耗令牌，最终令牌数=-1（逻辑错误）。

### 2. 降级策略
当 Redis 连接失败（如网络故障、Redis 宕机），自动降级为单机限流，避免服务完全不可用，符合企业级「熔断降级」的高可用要求。

### 3. 集群部署适配
- 每个 Koa 工作进程连接同一个 Redis 实例，共享令牌桶状态；
- 反向代理（如 Nginx）将请求分发到不同 Koa 节点，所有节点的限流规则统一；
- 生产环境建议使用 Redis 集群/哨兵，避免 Redis 单点故障。

### 4. 性能优化
- Redis 连接池：复用连接，避免频繁创建/关闭连接；
- Lua 脚本缓存：通过 `script load` 缓存脚本 SHA1 值，减少网络传输；
- 过期键清理：为 Redis 键设置过期时间，避免无用键占用内存。

## 四、测试验证（集群场景）
1. 启动 Redis 服务（确保集群所有节点可访问）；
2. 启动 Koa 集群应用（多工作进程）；
3. 用压测工具（如 ab、wrk）向不同端口的 Koa 节点发送请求：
   ```bash
   # 压测命令：向两个节点发送100次请求
   wrk -t10 -c10 -d10s http://localhost:3000/api/order/create
   wrk -t10 -c10 -d10s http://localhost:3001/api/order/create
   ```
4. 验证结果：两个节点的总请求数不会超过令牌桶的限流规则（如50次/10秒），实现集群统一限流。

