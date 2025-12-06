---
title: 初始化npm项目
tags:
categories:
  - Redis
date: 2025-12-06 21:18:21
---

### 一、环境准备
#### 1. 初始化项目 & 安装依赖
```bash
# 初始化npm项目
npm init -y
# 安装核心依赖：koa（后端框架）、ioredis（Redis客户端，比原生redis包更友好）、koa-router（路由）
npm install koa koa-router ioredis
```

#### 2. 基础配置（Redis连接 + Koa启动）
创建 `app.js` 作为入口文件，先完成Redis客户端初始化和Koa基础配置：
```javascript
const Koa = require('koa');
const Router = require('koa-router');
const Redis = require('ioredis');

// 1. 初始化Koa实例和路由
const app = new Koa();
const router = new Router();

// 2. 初始化Redis客户端（默认连接本地6379，无密码；远程需配置host/password）
const redis = new Redis({
  host: '127.0.0.1',
  port: 6379,
  password: '', // 本地Redis若无密码则留空
  db: 0, // 使用第0个数据库
  retryStrategy: (times) => { // 重连策略，避免Redis断开后服务挂掉
    const delay = Math.min(times * 100, 3000);
    return delay;
  }
});

// 监听Redis连接错误
redis.on('error', (err) => {
  console.error('Redis连接失败：', err);
});

// 3. 挂载路由 & 启动服务
app.use(router.routes()).use(router.allowedMethods());
app.listen(3000, () => {
  console.log('Koa服务启动：http://localhost:3000');
});

// 导出redis实例，供后续路由使用
module.exports = { redis };
```

### 二、各数据结构实战（附Koa路由代码）
以下所有示例均基于上述基础配置，在 `app.js` 中追加路由即可。

---

#### 1. String（字符串）
**核心场景**：缓存简单数据、计数器（阅读量/点赞数）、分布式锁  
**核心API**：`set/get/incr/expire/setnx`

##### 示例1：缓存用户信息（序列化JSON）
```javascript
/**
 * 接口：GET /user/info/:userId
 * 功能：获取用户信息（优先从Redis缓存，无则模拟查库后写入缓存）
 */
router.get('/user/info/:userId', async (ctx) => {
  const { userId } = ctx.params;
  const cacheKey = `user:info:${userId}`;

  // 1. 先查Redis缓存
  const cacheData = await redis.get(cacheKey);
  if (cacheData) {
    ctx.body = {
      code: 200,
      msg: '从缓存获取',
      data: JSON.parse(cacheData)
    };
    return;
  }

  // 2. 缓存未命中，模拟查询数据库（实际项目替换为MySQL/Mongo查询）
  const dbData = {
    userId,
    username: `用户${userId}`,
    age: 20 + parseInt(userId),
    phone: `1380000${userId.padStart(4, '0')}`
  };

  // 3. 写入Redis缓存，设置过期时间（避免缓存永久有效）
  await redis.set(cacheKey, JSON.stringify(dbData), 'EX', 3600); // EX：过期时间（秒），3600=1小时

  ctx.body = {
    code: 200,
    msg: '从数据库获取',
    data: dbData
  };
});
```

##### 示例2：文章阅读量计数器
```javascript
/**
 * 接口1：GET /article/visit/:articleId
 * 功能：增加文章阅读量（原子操作，避免并发问题）
 */
router.get('/article/visit/:articleId', async (ctx) => {
  const { articleId } = ctx.params;
  const countKey = `article:visit:${articleId}`;

  // incr：原子自增（即使多请求并发，也不会计数错误）
  const newCount = await redis.incr(countKey);

  ctx.body = {
    code: 200,
    msg: '阅读量+1成功',
    data: { articleId, visitCount: newCount }
  };
});

/**
 * 接口2：GET /article/visit/count/:articleId
 * 功能：获取文章当前阅读量
 */
router.get('/article/visit/count/:articleId', async (ctx) => {
  const { articleId } = ctx.params;
  const countKey = `article:visit:${articleId}`;

  // get：获取值，若key不存在则返回null，默认转为0
  const visitCount = await redis.get(countKey) || 0;

  ctx.body = {
    code: 200,
    data: { articleId, visitCount: parseInt(visitCount) }
  };
});
```

---

#### 2. Hash（哈希）
**核心场景**：存储多字段对象（用户详情）、购物车（用户ID→商品ID:数量）  
**核心API**：`hset/hget/hgetall/hincrby/hdel`

##### 示例1：存储用户详情（多字段，无需序列化JSON）
```javascript
/**
 * 接口1：POST /user/save/:userId
 * 功能：保存用户详情到Hash
 */
router.post('/user/save/:userId', async (ctx) => {
  const { userId } = ctx.params;
  const { username, age, email } = ctx.request.body; // 需配合koa-body解析请求体（npm install koa-body）
  const hashKey = `user:hash:${userId}`;

  // hset：批量设置Hash的字段和值
  await redis.hset(hashKey, {
    username,
    age,
    email,
    updateTime: new Date().toISOString()
  });

  // 设置过期时间（Hash本身不能直接设过期，需给key设）
  await redis.expire(hashKey, 86400); // 24小时过期

  ctx.body = { code: 200, msg: '用户信息保存成功' };
});

/**
 * 接口2：GET /user/hash/:userId
 * 功能：获取用户Hash详情（可单独获取某个字段，或全部）
 */
router.get('/user/hash/:userId', async (ctx) => {
  const { userId } = ctx.params;
  const hashKey = `user:hash:${userId}`;

  // 方式1：获取单个字段
  // const username = await redis.hget(hashKey, 'username');

  // 方式2：获取所有字段
  const userInfo = await redis.hgetall(hashKey);

  ctx.body = {
    code: 200,
    data: userInfo || {}
  };
});
```

##### 示例2：购物车功能
```javascript
/**
 * 接口1：POST /cart/add
 * 功能：添加商品到购物车
 * 请求体：{ userId: '1001', productId: 'p001', count: 1 }
 */
router.post('/cart/add', async (ctx) => {
  const { userId, productId, count } = ctx.request.body;
  const cartKey = `cart:${userId}`;

  // hincrby：原子增减购物车商品数量（避免并发超卖）
  // 若商品不存在则自动创建，值为count；若存在则累加
  await redis.hincrby(cartKey, productId, count);

  ctx.body = { code: 200, msg: '添加购物车成功' };
});

/**
 * 接口2：GET /cart/list/:userId
 * 功能：获取用户购物车列表
 */
router.get('/cart/list/:userId', async (ctx) => {
  const { userId } = ctx.params;
  const cartKey = `cart:${userId}`;

  // hgetall：获取购物车所有商品（productId: count）
  const cartList = await redis.hgetall(cartKey);
  // 格式转换：{ p001: '1', p002: '2' } → [{ productId: 'p001', count: 1 }, ...]
  const formatCart = Object.entries(cartList).map(([productId, count]) => ({
    productId,
    count: parseInt(count)
  }));

  ctx.body = {
    code: 200,
    data: formatCart
  };
});

/**
 * 接口3：POST /cart/delete
 * 功能：删除购物车商品
 * 请求体：{ userId: '1001', productId: 'p001' }
 */
router.post('/cart/delete', async (ctx) => {
  const { userId, productId } = ctx.request.body;
  const cartKey = `cart:${userId}`;

  await redis.hdel(cartKey, productId);

  ctx.body = { code: 200, msg: '删除商品成功' };
});
```

---

#### 3. List（列表）
**核心场景**：简单消息队列、最新动态列表（朋友圈/评论）  
**核心API**：`lpush/rpush/lpop/rpop/lrange/ltrim`

##### 示例1：简单消息队列（生产者+消费者）
```javascript
// 队列key
const msgQueueKey = 'queue:msg';

/**
 * 接口1：POST /queue/produce
 * 功能：生产消息（往队列头部塞）
 * 请求体：{ content: '订单支付成功' }
 */
router.post('/queue/produce', async (ctx) => {
  const { content } = ctx.request.body;
  const msg = {
    id: Date.now() + Math.random().toString(36).slice(2), // 唯一消息ID
    content,
    time: new Date().toISOString()
  };

  // lpush：往列表左侧（头部）添加消息
  await redis.lpush(msgQueueKey, JSON.stringify(msg));

  ctx.body = { code: 200, msg: '消息生产成功', data: msg.id };
});

/**
 * 接口2：GET /queue/consume
 * 功能：消费消息（从队列尾部取，FIFO）
 */
router.get('/queue/consume', async (ctx) => {
  // rpop：从列表右侧（尾部）取出消息，若队列为空则返回null
  const msgStr = await redis.rpop(msgQueueKey);
  if (!msgStr) {
    ctx.body = { code: 200, msg: '队列无消息' };
    return;
  }

  const msg = JSON.parse(msgStr);
  ctx.body = {
    code: 200,
    msg: '消费消息成功',
    data: msg
  };
});
```

##### 示例2：最新动态列表（限制仅保留10条）
```javascript
/**
 * 接口1：POST /dynamic/add/:userId
 * 功能：添加用户动态
 * 请求体：{ content: '今天天气不错' }
 */
router.post('/dynamic/add/:userId', async (ctx) => {
  const { userId } = ctx.params;
  const { content } = ctx.request.body;
  const dynamicKey = `dynamic:${userId}`;
  const dynamic = {
    content,
    time: new Date().toISOString()
  };

  // 1. 往列表头部添加动态
  await redis.lpush(dynamicKey, JSON.stringify(dynamic));
  // 2. 限制列表长度为10（只保留最新10条，超出的自动删除）
  await redis.ltrim(dynamicKey, 0, 9); // 0-9共10条

  ctx.body = { code: 200, msg: '动态添加成功' };
});

/**
 * 接口2：GET /dynamic/list/:userId
 * 功能：获取用户最新动态列表
 */
router.get('/dynamic/list/:userId', async (ctx) => {
  const { userId } = ctx.params;
  const dynamicKey = `dynamic:${userId}`;

  // lrange：获取列表所有元素（0到-1表示全部）
  const dynamicList = await redis.lrange(dynamicKey, 0, -1);
  const formatList = dynamicList.map(item => JSON.parse(item));

  ctx.body = {
    code: 200,
    data: formatList
  };
});
```

---

#### 4. Set（集合）
**核心场景**：好友关系（共同好友）、抽奖、标签去重  
**核心API**：`sadd/smembers/sinter/srandmember/spop`

##### 示例1：共同好友查询
```javascript
/**
 * 接口1：POST /friend/add
 * 功能：添加好友
 * 请求体：{ userId: '1001', friendId: '1002' }
 */
router.post('/friend/add', async (ctx) => {
  const { userId, friendId } = ctx.request.body;
  const friendKey = `friend:${userId}`;

  // sadd：添加好友到集合（自动去重，重复添加无效果）
  await redis.sadd(friendKey, friendId);

  ctx.body = { code: 200, msg: '添加好友成功' };
});

/**
 * 接口2：GET /friend/common/:userId1/:userId2
 * 功能：查询两个用户的共同好友
 */
router.get('/friend/common/:userId1/:userId2', async (ctx) => {
  const { userId1, userId2 } = ctx.params;
  const key1 = `friend:${userId1}`;
  const key2 = `friend:${userId2}`;

  // sinter：求两个集合的交集（共同好友）
  const commonFriends = await redis.sinter(key1, key2);

  ctx.body = {
    code: 200,
    data: {
      userId1,
      userId2,
      commonFriends // ['1003', '1004']
    }
  };
});
```

##### 示例2：抽奖功能
```javascript
// 抽奖池key
const lotteryKey = 'lottery:pool';

/**
 * 接口1：POST /lottery/join
 * 功能：加入抽奖（用户ID）
 * 请求体：{ userId: '1001' }
 */
router.post('/lottery/join', async (ctx) => {
  const { userId } = ctx.request.body;

  // sadd：加入抽奖池（自动去重，一个用户只能加一次）
  await redis.sadd(lotteryKey, userId);

  ctx.body = { code: 200, msg: '加入抽奖成功' };
});

/**
 * 接口2：GET /lottery/draw/:count
 * 功能：抽奖（count为中奖人数）
 */
router.get('/lottery/draw/:count', async (ctx) => {
  const { count } = ctx.params;
  const drawCount = parseInt(count);

  // 方式1：srandmember - 抽奖后用户仍在池子里（可重复中奖）
  // const winners = await redis.srandmember(lotteryKey, drawCount);

  // 方式2：spop - 抽奖后用户移出池子（不可重复中奖）
  const winners = await redis.spop(lotteryKey, drawCount);

  ctx.body = {
    code: 200,
    msg: `抽中${drawCount}人`,
    data: { winners }
  };
});
```

---

#### 5. Sorted Set（有序集合）
**核心场景**：排行榜、延时队列  
**核心API**：`zadd/zrevrange/zrangebyscore/zrem`

##### 示例1：游戏积分排行榜
```javascript
// 排行榜key
const rankKey = 'rank:game:score';

/**
 * 接口1：POST /rank/add
 * 功能：添加用户积分
 * 请求体：{ userId: '1001', score: 95 }
 */
router.post('/rank/add', async (ctx) => {
  const { userId, score } = ctx.request.body;

  // zadd：添加用户到有序集合（score为排序依据，userId为成员）
  await redis.zadd(rankKey, score, userId);

  ctx.body = { code: 200, msg: '积分添加成功' };
});

/**
 * 接口2：GET /rank/top/:size
 * 功能：获取排行榜前N名（降序，积分越高越靠前）
 */
router.get('/rank/top/:size', async (ctx) => {
  const { size } = ctx.params;
  const topSize = parseInt(size);

  // zrevrange：降序获取前N名（0到topSize-1），WITHSCORES表示同时返回积分
  const rankList = await redis.zrevrange(rankKey, 0, topSize - 1, 'WITHSCORES');
  
  // 格式转换：['1001', '95', '1002', '88'] → [{ userId: '1001', score: 95 }, ...]
  const formatRank = [];
  for (let i = 0; i < rankList.length; i += 2) {
    formatRank.push({
      rank: i / 2 + 1,
      userId: rankList[i],
      score: parseInt(rankList[i + 1])
    });
  }

  ctx.body = {
    code: 200,
    data: formatRank
  };
});
```

##### 示例2：延时队列（按时间戳执行任务）
```javascript
// 延时队列key
const delayQueueKey = 'delay:queue';

/**
 * 接口1：POST /delay/add
 * 功能：添加延时任务
 * 请求体：{ taskId: 't001', delaySeconds: 10, content: '10秒后执行的任务' }
 */
router.post('/delay/add', async (ctx) => {
  const { taskId, delaySeconds, content } = ctx.request.body;
  // 计算任务执行时间戳（当前时间 + 延迟秒数）
  const executeTime = Date.now() + delaySeconds * 1000;

  // zadd：score为执行时间戳，member为任务JSON
  const task = JSON.stringify({ taskId, content });
  await redis.zadd(delayQueueKey, executeTime, task);

  ctx.body = {
    code: 200,
    msg: '延时任务添加成功',
    data: { executeTime: new Date(executeTime).toISOString() }
  };
});

/**
 * 接口2：GET /delay/consume
 * 功能：消费延时任务（只执行已到时间的任务）
 */
router.get('/delay/consume', async (ctx) => {
  const now = Date.now();

  // zrangebyscore：获取score ≤ 当前时间的任务（0到now），只取1条
  const tasks = await redis.zrangebyscore(delayQueueKey, 0, now, 'LIMIT', 0, 1);
  if (tasks.length === 0) {
    ctx.body = { code: 200, msg: '暂无到期任务' };
    return;
  }

  const task = JSON.parse(tasks[0]);
  // 消费后删除任务（避免重复执行）
  await redis.zrem(delayQueueKey, tasks[0]);

  ctx.body = {
    code: 200,
    msg: '消费延时任务成功',
    data: task
  };
});
```

---

#### 6. BitMap（位图）
**核心场景**：用户签到、在线状态  
**核心API**：`setbit/getbit/bitcount`

##### 示例1：用户签到功能
```javascript
/**
 * 接口1：POST /sign/in/:userId/:day
 * 功能：用户签到（day为当月第几天，如1=1号）
 */
router.post('/sign/in/:userId/:day', async (ctx) => {
  const { userId, day } = ctx.params;
  const signKey = `sign:${userId}:202506`; // 按年月分key
  const dayNum = parseInt(day) - 1; // BitMap索引从0开始，1号对应索引0

  // setbit：设置某一位的值（1=签到，0=未签到）
  await redis.setbit(signKey, dayNum, 1);

  ctx.body = { code: 200, msg: '签到成功' };
});

/**
 * 接口2：GET /sign/count/:userId
 * 功能：查询用户当月签到天数
 */
router.get('/sign/count/:userId', async (ctx) => {
  const { userId } = ctx.params;
  const signKey = `sign:${userId}:202506`;

  // bitcount：统计位图中值为1的位数（签到天数）
  const signCount = await redis.bitcount(signKey);

  ctx.body = {
    code: 200,
    data: { userId, signCount, month: '2025年06月' }
  };
});
```

##### 示例2：用户在线状态
```javascript
/**
 * 接口1：POST /status/set/:userId/:status
 * 功能：设置用户在线状态（status=1在线，0离线）
 */
router.post('/status/set/:userId/:status', async (ctx) => {
  const { userId, status } = ctx.params;
  const statusKey = 'user:online:status';
  const userIdNum = parseInt(userId); // 位图索引用数字ID更方便

  await redis.setbit(statusKey, userIdNum, status);

  ctx.body = {
    code: 200,
    msg: `用户${userId}状态设为${status === '1' ? '在线' : '离线'}`
  };
});

/**
 * 接口2：GET /status/get/:userId
 * 功能：查询用户在线状态
 */
router.get('/status/get/:userId', async (ctx) => {
  const { userId } = ctx.params;
  const statusKey = 'user:online:status';
  const userIdNum = parseInt(userId);

  // getbit：获取某一位的值
  const status = await redis.getbit(statusKey, userIdNum);

  ctx.body = {
    code: 200,
    data: {
      userId,
      status: status === 1 ? '在线' : '离线'
    }
  };
});
```

---

#### 7. HyperLogLog（基数统计）
**核心场景**：UV统计（无需存储用户ID，仅统计去重人数）  
**核心API**：`pfadd/pfcount`

```javascript
// UV统计key
const uvKey = 'uv:website:202506';

/**
 * 接口1：POST /uv/add/:userId
 * 功能：记录访问用户（用于UV统计）
 */
router.post('/uv/add/:userId', async (ctx) => {
  const { userId } = ctx.params;

  // pfadd：添加用户到HyperLogLog（自动去重）
  await redis.pfadd(uvKey, userId);

  ctx.body = { code: 200, msg: '记录访问用户成功' };
});

/**
 * 接口2：GET /uv/count
 * 功能：获取当月网站UV（去重后的访问人数）
 */
router.get('/uv/count', async (ctx) => {
  // pfcount：统计基数（UV数，误差约0.81%）
  const uvCount = await redis.pfcount(uvKey);

  ctx.body = {
    code: 200,
    data: { month: '2025年06月', uvCount: parseInt(uvCount) }
  };
});
```

---

#### 8. Geo（地理位置）
**核心场景**：附近的商家/附近的人  
**核心API**：`geoadd/georadius/geodist`

```javascript
// 商家位置key
const geoKey = 'geo:merchant';

/**
 * 接口1：POST /geo/add
 * 功能：添加商家地理位置
 * 请求体：{ merchantId: 'm001', lng: 116.403963, lat: 39.915119, name: '北京王府井店' }
 */
router.post('/geo/add', async (ctx) => {
  const { merchantId, lng, lat, name } = ctx.request.body;
  // geoadd：添加地理位置（key, 经度, 纬度, 成员ID）
  await redis.geoadd(geoKey, lng, lat, `${merchantId}:${name}`);

  ctx.body = { code: 200, msg: '商家位置添加成功' };
});

/**
 * 接口2：GET /geo/near/:lng/:lat/:radius
 * 功能：获取附近的商家（radius为半径，单位米）
 */
router.get('/geo/near/:lng/:lat/:radius', async (ctx) => {
  const { lng, lat, radius } = ctx.params;
  const radiusNum = parseInt(radius);

  // georadius：根据经纬度找附近的成员
  // WITHDIST：返回距离（米），WITHCOORD：返回经纬度，ASC：按距离升序
  const nearMerchants = await redis.georadius(
    geoKey,
    lng,
    lat,
    radiusNum,
    'm', // 单位：m(米)/km(千米)/mi(英里)/ft(英尺)
    'WITHDIST',
    'WITHCOORD',
    'ASC'
  );

  // 格式转换
  const formatMerchants = nearMerchants.map(item => {
    const [idName, dist, [lng, lat]] = item;
    const [merchantId, name] = idName.split(':');
    return {
      merchantId,
      name,
      distance: `${parseFloat(dist).toFixed(2)}米`,
      location: { lng, lat }
    };
  });

  ctx.body = {
    code: 200,
    data: formatMerchants
  };
});
```

### 三、补充说明
1. **请求体解析**：上述POST接口需配合 `koa-body` 解析JSON请求体，安装后在 `app.js` 中添加：
   ```javascript
   const { koaBody } = require('koa-body');
   app.use(koaBody()); // 放在路由挂载前
   ```
2. **Redis异常处理**：生产环境需给每个Redis操作加try/catch，避免单个接口失败导致服务崩溃；
3. **性能优化**：批量操作建议用 `pipeline`，例如批量添加商家位置：
   ```javascript
   const pipeline = redis.pipeline();
   pipeline.geoadd(geoKey, 116.40, 39.91, 'm001:北京店');
   pipeline.geoadd(geoKey, 116.41, 39.92, 'm002:北京西单店');
   await pipeline.exec();
   ```
