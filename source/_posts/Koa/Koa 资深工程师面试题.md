---
title: 阶段1：构建
tags:
  - Koa
  - Vue
  - Redis
  - TypeScript
  - XSS
  - CSRF
  - 性能优化
  - 缓存
  - 面试
categories:
  - Koa
date: 2025-12-06 21:18:21
---

### Koa 资深工程师面试题（附详细答案）
以下题目覆盖**核心原理、中间件设计、安全、性能、工程化、运维**六大维度，适配资深工程师（3-5年）面试场景，答案聚焦企业级实战落地。

---

## 一、核心原理类（考察底层理解）
### 题目1：请详细讲解 Koa 的洋葱模型实现原理，结合源码说明 async/await 对其的影响
#### 答案：
1. **洋葱模型核心逻辑**：  
   Koa 中间件的执行顺序是“先进后出”——每个中间件执行完 `next()` 前的逻辑后，会交给下一个中间件执行，直到最后一个中间件执行完毕，再反向执行每个中间件 `next()` 后的逻辑，形似洋葱层层穿透。
   
2. **源码层面（compose 函数）**：  
   Koa 的核心是 `koa-compose` 库的 `compose` 函数，核心源码简化如下：
   ```javascript
   function compose(middlewares) {
     return function (ctx, next) {
       let index = -1;
       // 执行第一个中间件
       return dispatch(0);
       function dispatch(i) {
         if (i <= index) return Promise.reject(new Error('next() called multiple times'));
         index = i;
         let fn = middlewares[i];
         // 最后一个中间件的 next 是传入的外层 next
         if (i === middlewares.length) fn = next;
         if (!fn) return Promise.resolve();
         try {
           // 执行当前中间件，将 dispatch(i+1) 作为 next 传入（核心：递归调用下一个中间件）
           return Promise.resolve(fn(ctx, dispatch.bind(null, i + 1)));
         } catch (err) {
           return Promise.reject(err);
         }
       }
     };
   }
   ```
   - `dispatch` 函数递归调用下一个中间件，实现“穿透”；
   - 所有中间件最终返回 Promise，保证异步流程有序。

3. **async/await 的影响**：  
   Koa1 基于 Generator + co 库实现异步，Koa2 原生支持 async/await，核心变化：
   - 无需依赖 co 库，语法更简洁，原生支持 Promise 链；
   - 异步中间件必须加 `await next()`，否则会导致中间件执行顺序错乱（如 `next()` 未 await 会跳过后续中间件的反向执行逻辑）；
   - 错误捕获更友好：`try/catch` 可直接捕获异步错误，配合 `app.on('error')` 实现全局兜底。

4. **常见坑**：  
   - 多次调用 `next()`：compose 中通过 `index` 检测，避免重复执行；
   - 异步中间件未加 `await`：导致 `next()` 后的逻辑提前执行（如日志中间件未 await next()，会先打印日志再执行业务逻辑）。

### 题目2：Koa1 和 Koa2 的核心区别是什么？为什么 Koa2 选择拥抱 async/await 而非 Generator+co？
#### 答案：
| 维度       | Koa1                   | Koa2                      |
| ---------- | ---------------------- | ------------------------- |
| 异步方案   | Generator + co 库      | async/await（原生）       |
| 中间件写法 | `function * (next) {}` | `async (ctx, next) => {}` |
| 依赖       | 需引入 co 库           | 无额外依赖                |
| 错误处理   | 需通过 `co.wrap` 捕获  | 原生 try/catch 即可       |
| 生态兼容性 | 中间件需适配 Generator | 兼容 Promise 生态         |

**选择 async/await 的核心原因**：
1. **原生支持**：ES2017 标准化 async/await，无需依赖第三方库（co 库本质是 Generator 的语法糖），降低维护成本；
2. **可读性更高**：async/await 是线性写法，比 Generator 的 `yield` 更符合同步思维，团队协作成本低；
3. **错误处理更自然**：try/catch 可直接捕获异步错误，而 Generator 需通过 co 库的回调或 `throw` 传递错误；
4. **生态适配**：Node.js 原生支持 Promise，async/await 可无缝对接主流异步库（如 axios、sequelize）。

---

## 二、中间件设计与实践类（考察实战经验）
### 题目3：如何设计 Koa 项目的可复用、低耦合中间件体系？举例说明错误处理/鉴权中间件的最佳实践
#### 答案：
### 1. 中间件设计原则
- **单一职责**：一个中间件只做一件事（如日志、跨域、鉴权分开）；
- **顺序可控**：核心中间件（错误处理、日志）前置，业务中间件（路由、参数校验）后置；
- **参数传递**：通过 `ctx.state` 传递上下文（如用户信息），避免修改 ctx 原型链；
- **可配置化**：中间件支持入参配置（如跨域白名单、限流阈值），适配不同场景；
- **异常隔离**：中间件内部捕获自身错误，不影响全局流程。

### 2. 核心中间件最佳实践
#### （1）全局错误处理中间件（必须前置）
```javascript
// middleware/errorHandler.js
module.exports = () => {
  return async (ctx, next) => {
    try {
      await next();
      // 处理404（无路由匹配）
      if (ctx.status === 404) {
        ctx.status = 404;
        ctx.body = { code: 404, msg: '接口不存在' };
      }
    } catch (err) {
      // 区分业务错误和系统错误
      const isBusinessError = err.code && err.msg;
      ctx.status = isBusinessError ? 400 : 500;
      ctx.body = {
        code: isBusinessError ? err.code : 500,
        msg: isBusinessError ? err.msg : '服务暂不可用',
        // 开发环境返回堆栈，生产环境隐藏
        stack: process.env.NODE_ENV === 'development' ? err.stack : ''
      };
      // 触发全局 error 事件（用于日志记录）
      ctx.app.emit('error', err, ctx);
    }
  };
};

// 入口文件使用（第一个中间件）
app.use(errorHandler());
// 全局错误日志
app.on('error', (err, ctx) => {
  logger.error(`[${ctx.method}] ${ctx.url}`, {
    error: err.message,
    stack: err.stack,
    requestId: ctx.requestId // 全链路追踪ID
  });
});
```

#### （2）JWT 鉴权中间件（可复用+可配置）
```javascript
// middleware/auth.js
const jwt = require('jsonwebtoken');
module.exports = (options = { whiteList: [] }) => {
  return async (ctx, next) => {
    // 白名单接口跳过鉴权
    if (options.whiteList.includes(ctx.path)) {
      await next();
      return;
    }
    const token = ctx.headers.authorization?.split(' ')[1];
    if (!token) {
      ctx.throw({ code: 401, msg: '未携带令牌' });
    }
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      // 挂载用户信息到上下文
      ctx.state.user = { id: payload.userId, role: payload.role };
      await next();
    } catch (err) {
      ctx.throw({ code: 401, msg: '令牌无效或已过期' });
    }
  };
};

// 入口文件使用
app.use(auth({
  whiteList: ['/api/login', '/api/register', '/api/captcha']
}));
```

### 题目4：Koa 中间件开发中，哪些场景会导致内存泄漏？如何检测和避免？
#### 答案：
### 1. 常见内存泄漏场景
- **未释放的异步资源**：
  - 中间件中创建定时器（`setTimeout/setInterval`）未清除；
  - 事件监听（如 `emitter.on('event', fn)`）未移除，导致闭包引用 ctx；
  - 数据库/Redis 连接未释放（如未使用连接池，每次请求创建新连接）。
- **不合理的缓存**：
  - 全局对象（如 `global.cache = {}`）存储大量数据，未设置过期；
  - 中间件中缓存请求数据时，键未清理（如用户ID作为键，用户注销后未删除）。
- **闭包引用**：
  - 中间件内部函数长期引用 ctx 或大对象，导致 GC 无法回收。

### 2. 检测方法
- **工具层面**：
  - `clinic.js`：Node.js 官方性能工具，通过 `clinic bubbleprof` 分析事件循环和内存占用；
  - `node-inspect` + Chrome DevTools：断点调试内存快照，查看堆内存中的冗余对象；
  - `pm2 monit`：监控线上进程的内存使用率，若持续上涨则大概率泄漏。
- **日志层面**：
  - 记录每个请求的内存占用（`process.memoryUsage()`），定位泄漏接口。

### 3. 避免措施
- **资源释放**：
  - 定时器使用后通过 `clearTimeout/clearInterval` 清除；
  - 事件监听使用 `once` 替代 `on`，或在请求结束后 `off` 移除；
  - 数据库/Redis 必须使用连接池，复用长连接（如 Sequelize 配置 `pool: { max: 10, min: 2 }`）。
- **缓存管控**：
  - 避免使用全局对象缓存，改用 Redis 并设置过期时间；
  - 本地缓存使用 LRU 策略（如 `lru-cache` 库），限制最大容量。
- **代码规范**：
  - 中间件内部避免闭包长期引用 ctx，仅提取必要字段（如 `userId`）而非整个 ctx；
  - 异步操作确保 `await` 执行完成，避免未处理的 Promise 挂起。

---

## 三、安全防护进阶类（企业级核心）
### 题目5：Koa 中实现 JWT 鉴权时，如何解决 token 泄露、刷新、黑名单问题？
#### 答案：
### 1. 解决 token 泄露问题
- **传输层**：强制 HTTPS，禁止 HTTP 传输 token；
- **存储层**：
  - 前端：refreshToken 存入 `httpOnly + secure` Cookie（防止 XSS 窃取），accessToken 存入内存（如 Vuex），不存 localStorage；
  - 后端：token 中不存储敏感信息（如密码），仅存 userId/role 等非敏感字段。
- **过期策略**：accessToken 短期（15-30分钟），refreshToken 长期（7天），降低泄露风险。

### 2. token 刷新机制（企业级方案）
```javascript
// 刷新 token 接口
app.post('/api/refresh-token', async (ctx) => {
  const { refreshToken } = ctx.cookies.get('refreshToken'); // 从 httpOnly Cookie 获取
  if (!refreshToken) {
    ctx.throw({ code: 401, msg: '刷新令牌缺失' });
  }
  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_SECRET);
    // 校验 refreshToken 类型（防止 accessToken 冒充）
    if (payload.type !== 'refresh') {
      ctx.throw({ code: 401, msg: '刷新令牌无效' });
    }
    // 生成新的 accessToken
    const newAccessToken = jwt.sign(
      { userId: payload.userId, role: payload.role },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );
    ctx.body = { code: 200, data: { accessToken: newAccessToken } };
  } catch (err) {
    ctx.throw({ code: 401, msg: '刷新令牌过期，请重新登录' });
  }
});
```

### 3. token 黑名单（解决用户主动退出/账号异常）
- 基于 Redis 实现，将失效 token 存入黑名单，设置过期时间与 token 有效期一致：
```javascript
// 退出登录接口（加入黑名单）
app.post('/api/logout', async (ctx) => {
  const token = ctx.headers.authorization?.split(' ')[1];
  if (token) {
    // 解析 token 剩余有效期
    const decoded = jwt.decode(token);
    const expireTime = decoded.exp - Math.floor(Date.now() / 1000);
    // 存入 Redis 黑名单，过期时间=剩余有效期
    await redis.set(`blacklist:${token}`, '1', 'EX', expireTime);
  }
  // 清除 refreshToken Cookie
  ctx.cookies.set('refreshToken', '', { expires: new Date(0) });
  ctx.body = { code: 200, msg: '退出成功' };
});

// 鉴权中间件增加黑名单校验
const authMiddleware = async (ctx, next) => {
  // ... 省略 token 获取逻辑
  // 校验黑名单
  const isBlacklisted = await redis.get(`blacklist:${token}`);
  if (isBlacklisted) {
    ctx.throw({ code: 401, msg: '令牌已失效' });
  }
  // ... 后续鉴权逻辑
};
```

### 题目6：Koa 项目中如何防范 SQL 注入、XSS、CSRF 攻击？除常规中间件外，还有哪些进阶防护手段？
#### 答案：
### 1. 常规防护手段（基础）
| 攻击类型 | 防护手段                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| SQL 注入 | 1. 优先使用 ORM（Sequelize/TypeORM），参数绑定；<br>2. 禁止手写 SQL，必须写则用预处理语句；<br>3. joi/ajv 严格校验入参 |
| XSS      | 1. koa-helmet 设置 CSP 头；<br>2. xss 库过滤入参；<br>3. 前端渲染时转义（后端兜底）                                    |
| CSRF     | 1. koa-csrf 生成 token；<br>2. 敏感接口校验 X-CSRF-Token 头；<br>3. 禁止 GET 方法修改数据                              |

### 2. 进阶防护手段（企业级）
- **SQL 注入进阶**：
  - 数据库账号权限最小化（如查询账号无删改权限）；
  - 定期使用 SQLMap 扫描接口，检测注入漏洞；
  - 对敏感操作（如删改数据）记录审计日志，便于溯源。
- **XSS 进阶**：
  - 接入 WAF（Web 应用防火墙），拦截恶意脚本请求；
  - 上传文件时校验文件类型（禁止 .html/.js），存储时重命名；
  - 敏感接口（如用户资料修改）限制请求来源 IP。
- **CSRF 进阶**：
  - 结合 IP + User-Agent 校验请求合法性；
  - 敏感操作（如支付）增加二次验证（短信/验证码）；
  - 设置 SameSite=Strict/Lax 属性，限制 Cookie 跨域发送。
- **通用进阶手段**：
  - 接口限流（分布式），防止暴力攻击；
  - 敏感信息脱敏（日志中隐藏手机号/身份证）；
  - 定期更新依赖（npm audit），修复已知漏洞。

---

## 四、性能优化与高并发类
### 题目7：Koa 单进程无法利用多核 CPU，如何实现多进程部署？多进程下如何解决共享资源问题？
#### 答案：
### 1. 多进程部署方案
#### （1）Cluster 模块（原生）
```javascript
// cluster.js
const cluster = require('cluster');
const os = require('os');
const numCPUs = os.cpus().length;

if (cluster.isPrimary) {
  // 主进程：根据 CPU 核心数创建子进程
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  // 子进程崩溃时重启
  cluster.on('exit', (worker) => {
    console.log(`子进程 ${worker.process.pid} 崩溃，重启中...`);
    cluster.fork();
  });
} else {
  // 子进程：启动 Koa 服务
  const app = require('./app');
  app.listen(3000, () => {
    console.log(`子进程 ${process.pid} 启动，监听 3000 端口`);
  });
}
```

#### （2）PM2（企业级推荐）
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'koa-app',
    script: 'app.js',
    instances: 'max', // 自动适配 CPU 核心数
    exec_mode: 'cluster', // 集群模式
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    },
    // 进程守护配置
    autorestart: true,
    max_memory_restart: '1G', // 内存超过 1G 重启
    // 日志配置
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    out_file: './logs/out.log',
    error_file: './logs/error.log'
  }]
};

// 启动命令：pm2 start ecosystem.config.js --env production
```

### 2. 多进程共享资源问题解决
- **数据库/Redis 连接池**：
  - 每个子进程独立创建连接池，总连接数 = 进程数 × 单进程连接数（如 8 进程 × 10 连接 = 80 总连接，不超过数据库最大连接数）；
  - 示例（Sequelize 配置）：
    ```javascript
    const sequelize = new Sequelize({
      dialect: 'mysql',
      pool: {
        max: 10, // 单进程最大连接数
        min: 2,
        idle: 30000
      }
    });
    ```
- **共享配置/缓存**：
  - 配置：通过环境变量/配置中心（如 nconf）统一管理，避免进程间同步；
  - 缓存：使用 Redis 分布式缓存，替代本地内存缓存；
- **端口占用**：
  - 多进程监听同一端口（Node.js 底层会做端口复用），无需手动分配端口。

### 题目8：Koa 高并发场景下，如何优化数据库操作和接口响应速度？举例说明缓存策略落地
#### 答案：
### 1. 数据库操作优化
- **异步并发优化**：
  避免串行查询，使用 `Promise.all` 并行执行无关查询：
  ```javascript
  // 优化前（串行，耗时=查询1+查询2）
  const user = await User.findByPk(userId);
  const orders = await Order.findAll({ where: { userId } });

  // 优化后（并行，耗时=max(查询1, 查询2)）
  const [user, orders] = await Promise.all([
    User.findByPk(userId),
    Order.findAll({ where: { userId } })
  ]);
  ```
- **连接池调优**：
  根据并发量调整连接池大小（如高并发场景设置 `max: 20`），避免连接耗尽；
- **SQL 优化**：
  - 给常用查询字段加索引（如 `userId`、`orderId`）；
  - 避免 `SELECT *`，仅查询必要字段；
  - 分页查询使用 `LIMIT/OFFSET`，禁止全表扫描。

### 2. 缓存策略落地（解决穿透/击穿/雪崩）
#### （1）缓存架构（Redis + 本地缓存）
- 高频读、低频写接口（如商品详情、首页数据）：Redis 缓存为主，本地 LRU 缓存为辅；
- 缓存键设计：`{业务前缀}:{参数}`（如 `goods:detail:1001`）。

#### （2）解决缓存问题
| 问题     | 解决方案                                                                                     |
| -------- | -------------------------------------------------------------------------------------------- |
| 缓存穿透 | 布隆过滤器（提前过滤不存在的键）+ 空值缓存（如 `goods:detail:9999` → `null`，过期时间5分钟） |
| 缓存击穿 | 互斥锁（Redis SETNX）：同一时间仅一个请求查询数据库，其他请求等待缓存更新                    |
| 缓存雪崩 | 过期时间随机化（如基础过期时间1小时，随机±10分钟）+  Redis 集群（避免单点故障）              |

#### （3）代码示例（商品详情接口）
```javascript
const Redis = require('ioredis');
const redis = new Redis();
const LRU = require('lru-cache');
// 本地 LRU 缓存（容量1000，过期5分钟）
const localCache = new LRU({ max: 1000, ttl: 5 * 60 * 1000 });

app.get('/api/goods/:id', async (ctx) => {
  const goodsId = ctx.params.id;
  const cacheKey = `goods:detail:${goodsId}`;

  // 1. 先查本地缓存
  const localData = localCache.get(cacheKey);
  if (localData) {
    ctx.body = { code: 200, data: localData };
    return;
  }

  // 2. 查 Redis 缓存
  let redisData = await redis.get(cacheKey);
  if (redisData) {
    redisData = JSON.parse(redisData);
    // 更新本地缓存
    localCache.set(cacheKey, redisData);
    ctx.body = { code: 200, data: redisData };
    return;
  }

  // 3. 缓存穿透：布隆过滤器校验
  const exists = await bloomFilter.has(goodsId);
  if (!exists) {
    ctx.body = { code: 404, msg: '商品不存在' };
    // 空值缓存
    await redis.set(cacheKey, JSON.stringify(null), 'EX', 5 * 60);
    return;
  }

  // 4. 缓存击穿：互斥锁
  const lockKey = `lock:goods:${goodsId}`;
  const lock = await redis.set(lockKey, '1', 'NX', 'EX', 10); // 锁过期10秒
  if (!lock) {
    // 未获取锁，等待50ms后重试
    await new Promise(resolve => setTimeout(resolve, 50));
    ctx.redirect(ctx.url);
    return;
  }

  // 5. 查询数据库
  const goodsData = await Goods.findByPk(goodsId);
  if (!goodsData) {
    ctx.body = { code: 404, msg: '商品不存在' };
    await redis.set(cacheKey, JSON.stringify(null), 'EX', 5 * 60);
    redis.del(lockKey); // 释放锁
    return;
  }

  // 6. 更新缓存（过期时间随机化）
  const expireTime = 3600 + Math.floor(Math.random() * 600); // 1小时±10分钟
  await redis.set(cacheKey, JSON.stringify(goodsData), 'EX', expireTime);
  localCache.set(cacheKey, goodsData);
  redis.del(lockKey); // 释放锁

  ctx.body = { code: 200, data: goodsData };
});
```

---

## 五、工程化与架构设计类
### 题目9：如何设计 Koa+TypeScript 的企业级项目架构？说明分层边界和规范
#### 答案：
### 1. 目录结构（分层设计）
```
src/
├── config/          # 配置文件（多环境、数据库、Redis）
│   ├── index.ts     # 配置导出
│   ├── dev.ts       # 开发环境
│   └── prod.ts      # 生产环境
├── controller/      # 控制器（仅处理请求/响应，不包含业务逻辑）
│   └── goods.controller.ts
├── service/         # 服务层（核心业务逻辑，可复用）
│   └── goods.service.ts
├── model/           # 数据模型（ORM 定义）
│   └── goods.model.ts
├── middleware/      # 中间件（全局/业务）
│   ├── errorHandler.ts
│   └── auth.ts
├── router/          # 路由（仅映射路由→控制器）
│   ├── index.ts
│   └── goods.router.ts
├── utils/           # 工具函数（通用方法）
│   ├── logger.ts
│   └── validator.ts
├── types/           # TypeScript 类型定义
│   └── index.ts
└── app.ts           # 入口文件
```

### 2. 分层边界与规范
| 层级           | 职责                                                                     | 禁止操作                                      |
| -------------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| 路由层         | 1. 定义接口路径/方法；<br>2. 映射路由到控制器；<br>3. 绑定参数校验中间件 | 1. 处理业务逻辑；<br>2. 操作数据库            |
| 控制器层       | 1. 接收请求参数；<br>2. 调用服务层；<br>3. 统一响应格式                  | 1. 直接操作数据库；<br>2. 复杂业务逻辑        |
| 服务层         | 1. 核心业务逻辑；<br>2. 调用数据层；<br>3. 事务处理                      | 1. 处理请求/响应；<br>2. 直接操作 HTTP 上下文 |
| 数据层（模型） | 1. 定义数据结构；<br>2. 数据库 CURD；<br>3. 关联查询                     | 1. 业务逻辑；<br>2. 依赖 HTTP 上下文          |

### 3. TypeScript 规范
- 定义接口请求/响应类型：
  ```typescript
  // types/index.ts
  export interface GoodsDetailReq {
    id: number;
  }
  export interface GoodsDetailRes {
    code: number;
    data: {
      id: number;
      name: string;
      price: number;
    };
  }
  ```
- 控制器使用类型约束：
  ```typescript
  // controller/goods.controller.ts
  import { Context } from 'koa';
  import { GoodsDetailReq, GoodsDetailRes } from '../types';
  import goodsService from '../service/goods.service';

  class GoodsController {
    async getDetail(ctx: Context): Promise<void> {
      const params = ctx.params as GoodsDetailReq;
      const data = await goodsService.getDetail(params.id);
      const res: GoodsDetailRes = { code: 200, data };
      ctx.body = res;
    }
  }
  ```
- 强制类型校验：启用 `strict: true`（tsconfig.json），禁止 `any` 类型（特殊场景需注释说明）。

### 题目10：Koa 项目如何实现多环境配置管理和敏感信息保护？
#### 答案：
### 1. 多环境配置管理（dotenv + 分层配置）
- **步骤1**：安装依赖 `dotenv` + `cross-env`（设置环境变量）；
- **步骤2**：创建多环境配置文件：
  ```
  config/
  ├── .env.development # 开发环境（本地）
  ├── .env.test        # 测试环境
  └── .env.production  # 生产环境（不上传代码仓库）
  ```
- **步骤3**：配置加载逻辑：
  ```javascript
  // config/index.ts
  import dotenv from 'dotenv';
  import path from 'path';

  // 根据 NODE_ENV 加载对应配置
  const env = process.env.NODE_ENV || 'development';
  dotenv.config({
    path: path.resolve(__dirname, `.env.${env}`)
  });

  // 导出配置（类型约束）
  export default {
    port: process.env.PORT || 3000,
    mysql: {
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT),
      username: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DB
    },
    redis: {
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT)
    },
    jwt: {
      secret: process.env.JWT_SECRET,
      expiresIn: process.env.JWT_EXPIRES_IN
    }
  };
  ```
- **步骤4**：启动脚本（package.json）：
  ```json
  "scripts": {
    "dev": "cross-env NODE_ENV=development ts-node src/app.ts",
    "test": "cross-env NODE_ENV=test ts-node src/app.ts",
    "prod": "cross-env NODE_ENV=production node dist/app.js"
  }
  ```

### 2. 敏感信息保护（企业级方案）
- **开发/测试环境**：
  - `.env` 文件加入 `.gitignore`，避免提交代码仓库；
  - 团队共享配置通过加密文档/配置中心（如 Nacos）分发。
- **生产环境**：
  - 禁止本地存储 `.env` 文件，通过容器/云平台环境变量注入（如 Docker -e、K8s ConfigMap/Secret）；
  - 敏感信息（如数据库密码、JWT 密钥）使用密钥管理服务（如 HashiCorp Vault、阿里云 KMS），运行时动态获取；
  - 示例（Vault 集成）：
    ```javascript
    const { Vault } = require('node-vault');
    const vault = new Vault({ apiVersion: 'v1', endpoint: 'https://vault.your-domain.com' });

    // 从 Vault 获取敏感配置
    async function getSecretConfig() {
      await vault.auth.approle({ role_id: process.env.VAULT_ROLE_ID, secret_id: process.env.VAULT_SECRET_ID });
      const secret = await vault.read('secret/koa-app/prod');
      return secret.data; // 包含 mysql.password、jwt.secret 等
    }
    ```

---

## 六、故障排查与运维类
### 题目11：Koa 线上项目出现接口超时、500 错误，如何快速定位问题？
#### 答案：
### 1. 排查流程（从易到难）
#### （1）日志层面（快速定位）
- **结构化日志**：使用 winston/pino 记录完整上下文：
  ```javascript
  // utils/logger.ts
  const winston = require('winston');
  const logger = winston.createLogger({
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json(),
      // 加入请求ID（全链路追踪）
      winston.format((info) => {
        info.requestId = info.requestId || 'unknown';
        return info;
      })()
    ),
    transports: [
      new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
      new winston.transports.File({ filename: 'logs/combined.log' })
    ]
  });
  ```
- **排查步骤**：
  1. 查看 `error.log`，筛选 500 错误的请求ID、堆栈信息；
  2. 查看 `combined.log`，定位该请求的入参、执行时间、数据库耗时；
  3. 若为超时，查看日志中是否有“数据库连接超时”“Redis 超时”等关键词。

#### （2）监控层面（定位性能瓶颈）
- **接口监控**：Prometheus + Grafana 监控接口响应时间、错误率、QPS；
- **服务器监控**：监控 CPU/内存/磁盘 IO（如 node-exporter + Grafana）；
- **数据库监控**：监控慢查询、连接数、锁等待（如 MySQL Slow Query Log）。

#### （3）工具层面（深度排查）
- **PM2 工具**：
  - `pm2 logs`：实时查看进程日志；
  - `pm2 monit`：监控进程内存/CPU 使用率；
  - `pm2 trace <pid>`：追踪进程系统调用。
- **性能分析**：
  - `clinic.js`：分析事件循环延迟、内存泄漏；
  - `node --inspect`：远程调试线上进程（需临时开启，注意安全）。

#### （4）常见问题定位
- **接口超时**：
  - 数据库慢查询 → 优化 SQL/索引；
  - 第三方接口超时 → 增加超时时间/重试机制；
  - 连接池耗尽 → 调整连接池大小。
- **500 错误**：
  - 代码 bug → 查看堆栈信息修复；
  - 依赖包版本问题 → 回滚稳定版本；
  - 资源不足（内存/磁盘）→ 扩容/清理磁盘。

### 题目12：Koa 项目如何实现 Docker + K8s 容器化部署？
#### 答案：
### 1. Docker 部署（Dockerfile 编写）
```dockerfile
# 阶段1：构建
FROM node:18-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --registry=https://registry.npm.taobao.org
COPY . .
RUN npm run build # 假设 tsconfig.json 配置输出到 dist/

# 阶段2：运行（精简镜像）
FROM node:18-alpine
WORKDIR /app
# 复制构建产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
# 仅安装生产依赖
RUN npm ci --production --registry=https://registry.npm.taobao.org
# 暴露端口
EXPOSE 3000
# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
# 启动命令（PM2 进程守护）
CMD ["npm", "run", "prod"]
```

### 2. K8s 部署（核心配置）
#### （1）Deployment（部署应用）
```yaml
# koa-app-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: koa-app
  namespace: prod
spec:
  replicas: 3 # 3 副本（高可用）
  selector:
    matchLabels:
      app: koa-app
  template:
    metadata:
      labels:
        app: koa-app
    spec:
      containers:
      - name: koa-app
        image: your-registry/koa-app:v1.0.0
        ports:
        - containerPort: 3000
        # 环境变量（敏感信息用 Secret 挂载）
        env:
        - name: NODE_ENV
          value: "production"
        - name: PORT
          value: "3000"
        - name: MYSQL_HOST
          valueFrom:
            configMapKeyRef:
              name: koa-app-config
              key: mysql_host
        - name: MYSQL_PASSWORD
          valueFrom:
            secretKeyRef:
              name: koa-app-secret
              key: mysql_password
        # 资源限制
        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            cpu: 500m
            memory: 512Mi
        # 健康检查
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

#### （2）Service（暴露服务）
```yaml
# koa-app-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: koa-app-service
  namespace: prod
spec:
  selector:
    app: koa-app
  ports:
  - port: 80
    targetPort: 3000
  type: ClusterIP # 内部访问，外部通过 Ingress 暴露
```

#### （3）HPA（自动扩缩容）
```yaml
# koa-app-hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: koa-app-hpa
  namespace: prod
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: koa-app
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70 # CPU 使用率超过70%扩容
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80 # 内存使用率超过80%扩容
```

---
