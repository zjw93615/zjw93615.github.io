---
title: Koa 处理死锁
tags:
  - Koa
categories:
  - Koa
date: 2025-12-06 21:18:21
---

在 Koa 企业级应用开发中，死锁的本质是**异步资源竞争下的循环等待**（Node.js 主线程单线程特性，死锁多表现为异步资源/外部依赖的互相等待，而非传统多线程死锁）。以下是 Koa 中最常见的死锁场景、详细示例及解决方案：

### 核心前提
Node.js 主线程是单线程，本身不会出现多线程死锁，但 Koa 作为异步框架，死锁主要出现在：
1. 自定义异步锁使用不当；
2. 数据库事务/行锁的竞争；
3. 异步资源未释放导致的“伪死锁”（事件循环阻塞）。

---

## 场景1：自定义异步锁顺序不一致导致死锁
### 场景描述
Koa 中间件中，多个接口需要获取多个异步锁，但锁的获取顺序相反，导致互相等待、无法释放。

### 示例代码（死锁场景）
```javascript
const Koa = require('koa');
const app = new Koa();

// 简易异步锁实现（无超时、无顺序约束）
class AsyncLock {
  constructor() {
    this.locks = new Map(); // 存储已持有的锁
  }
  // 获取锁：轮询等待锁释放
  async acquire(key) {
    while (this.locks.has(key)) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    this.locks.set(key, true);
  }
  // 释放锁
  release(key) {
    this.locks.delete(key);
  }
}
const lock = new AsyncLock();

// 接口1：先获取lockA，再获取lockB
app.use(async (ctx, next) => {
  if (ctx.path === '/api1') {
    await lock.acquire('lockA');
    await new Promise(resolve => setTimeout(resolve, 100)); // 模拟异步业务
    await lock.acquire('lockB'); // 等待lockB（被/api2持有）

    ctx.body = 'api1 success';
    lock.release('lockB');
    lock.release('lockA');
  }
  await next();
});

// 接口2：先获取lockB，再获取lockA
app.use(async (ctx, next) => {
  if (ctx.path === '/api2') {
    await lock.acquire('lockB');
    await new Promise(resolve => setTimeout(resolve, 100)); // 模拟异步业务
    await lock.acquire('lockA'); // 死锁点：等待lockA（被/api1持有）

    ctx.body = 'api2 success';
    lock.release('lockA');
    lock.release('lockB');
  }
  await next();
});

app.listen(3000);
```

### 死锁原因
当 `/api1` 和 `/api2` 同时请求时：
- `/api1` 持有 `lockA`，等待 `lockB`；
- `/api2` 持有 `lockB`，等待 `lockA`；
双方互相等待，锁无法释放，形成死锁，请求永久挂起。

### 解决方案
#### 方案1：统一锁的获取顺序（核心）
所有需要获取多锁的场景，按固定顺序（如锁名字母序、业务优先级）获取，打破循环等待。
修改 `/api2` 逻辑：
```javascript
app.use(async (ctx, next) => {
  if (ctx.path === '/api2') {
    // 统一顺序：先lockA，再lockB（和/api1一致）
    await lock.acquire('lockA');
    await new Promise(resolve => setTimeout(resolve, 100));
    await lock.acquire('lockB');

    ctx.body = 'api2 success';
    lock.release('lockB');
    lock.release('lockA');
  }
  await next();
});
```

#### 方案2：给锁添加超时机制（避免永久等待）
修改 `AsyncLock` 的 `acquire` 方法，超时后抛出错误：
```javascript
async acquire(key, timeout = 5000) {
  const start = Date.now();
  while (this.locks.has(key)) {
    // 超时判断
    if (Date.now() - start > timeout) {
      throw new Error(`获取锁 ${key} 超时（${timeout}ms）`);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  this.locks.set(key, true);
}
```

---

## 场景2：数据库事务行锁竞争导致死锁（企业级最常见）
### 场景描述
Koa 中使用 Sequelize/TypeORM 等 ORM 操作 MySQL/PostgreSQL 时，多事务同时更新**同一批行**，但更新顺序相反，触发数据库行锁死锁。

### 示例代码（死锁场景）
以 Sequelize 操作订单/库存表为例：
```javascript
const Koa = require('koa');
const { Sequelize, DataTypes } = require('sequelize');
const app = new Koa();

// 初始化数据库连接
const sequelize = new Sequelize('mysql://user:password@localhost:3306/koa_enterprise');

// 定义订单表
class Order extends Sequelize.Model {}
Order.init({
  orderId: { type: DataTypes.STRING, primaryKey: true },
  status: DataTypes.STRING,
  goodsId: DataTypes.STRING
}, { sequelize, tableName: 'orders' });

// 定义库存表
class Stock extends Sequelize.Model {}
Stock.init({
  goodsId: { type: DataTypes.STRING, primaryKey: true },
  num: DataTypes.INTEGER
}, { sequelize, tableName: 'stocks' });

// 接口1：创建订单 → 先更订单（行A），再更库存（行B）
app.use(async (ctx, next) => {
  if (ctx.path === '/create-order') {
    const t = await sequelize.transaction(); // 开启事务
    try {
      // 更新订单行A（orderId=123）
      await Order.update(
        { status: 'paid' },
        { where: { orderId: '123' }, transaction: t }
      );
      await new Promise(resolve => setTimeout(resolve, 100)); // 模拟延迟
      // 更新库存行B（goodsId=456）
      await Stock.update(
        { num: Sequelize.literal('num - 1') },
        { where: { goodsId: '456' }, transaction: t }
      );
      await t.commit();
      ctx.body = '订单创建成功';
    } catch (e) {
      await t.rollback();
      ctx.throw(500, e.message);
    }
  }
  await next();
});

// 接口2：调整库存 → 先更库存（行B），再更订单（行A）
app.use(async (ctx, next) => {
  if (ctx.path === '/adjust-stock') {
    const t = await sequelize.transaction(); // 开启事务
    try {
      // 更新库存行B（goodsId=456）
      await Stock.update(
        { num: Sequelize.literal('num + 1') },
        { where: { goodsId: '456' }, transaction: t }
      );
      await new Promise(resolve => setTimeout(resolve, 100)); // 模拟延迟
      // 更新订单行A（orderId=123）
      await Order.update(
        { status: 'adjusted' },
        { where: { orderId: '123' }, transaction: t }
      );
      await t.commit();
      ctx.body = '库存调整成功';
    } catch (e) {
      await t.rollback();
      ctx.throw(500, e.message);
    }
  }
  await next();
});

app.listen(3000);
```

### 死锁原因
- 事务1（/create-order）持有订单行A的锁，等待库存行B的锁；
- 事务2（/adjust-stock）持有库存行B的锁，等待订单行A的锁；
MySQL 检测到循环等待后，会回滚其中一个事务（错误码 1213），但应用层若未处理，会导致业务失败；若死锁未被检测，请求会永久阻塞。

### 解决方案
#### 方案1：统一事务更新顺序
所有事务更新多表/多行时，按**固定顺序**（如表名字母序、主键升序）操作：
```javascript
// 修改/adjust-stock接口：先更订单，再更库存（和/create-order一致）
app.use(async (ctx, next) => {
  if (ctx.path === '/adjust-stock') {
    const t = await sequelize.transaction();
    try {
      // 先更新订单行A
      await Order.update(
        { status: 'adjusted' },
        { where: { orderId: '123' }, transaction: t }
      );
      await new Promise(resolve => setTimeout(resolve, 100));
      // 再更新库存行B
      await Stock.update(
        { num: Sequelize.literal('num + 1') },
        { where: { goodsId: '456' }, transaction: t }
      );
      await t.commit();
      ctx.body = '库存调整成功';
    } catch (e) {
      await t.rollback();
      ctx.throw(500, e.message);
    }
  }
  await next();
});
```

#### 方案2：捕获死锁错误并自动重试
针对 MySQL 死锁错误码（1213），添加重试逻辑（最多3次）：
```javascript
app.use(async (ctx, next) => {
  if (ctx.path === '/create-order') {
    // 重试计数器
    ctx.retryCount = ctx.retryCount || 0;
    const maxRetry = 3;
    let t;
    try {
      t = await sequelize.transaction();
      await Order.update(/* ... */, { transaction: t });
      await new Promise(resolve => setTimeout(resolve, 100));
      await Stock.update(/* ... */, { transaction: t });
      await t.commit();
      ctx.body = '订单创建成功';
    } catch (e) {
      if (t) await t.rollback();
      // 检测死锁错误码 + 未达重试上限
      if (e.parent?.errno === 1213 && ctx.retryCount < maxRetry) {
        ctx.retryCount++;
        // 重新执行当前中间件
        return ctx.middleware[ctx.index](ctx, next);
      }
      ctx.throw(500, e.message);
    }
  }
  await next();
});
```

#### 方案3：缩短事务持有时间
将非数据库操作（如第三方接口调用、日志记录）放到事务外，减少锁持有时间。

---

## 场景3：异步资源未释放导致的“伪死锁”
### 场景描述
Koa 中间件中忘记释放锁/关闭资源，或执行同步耗时操作阻塞事件循环，导致后续请求永久等待（看似死锁）。

### 示例1：锁未释放（死锁）
```javascript
app.use(async (ctx, next) => {
  if (ctx.path === '/forget-release') {
    await lock.acquire('lockC');
    // 业务逻辑抛出错误，锁未释放
    throw new Error('业务异常');
    lock.release('lockC'); // 永远不会执行
  }
  await next();
});
```

### 示例2：同步耗时操作阻塞事件循环（伪死锁）
```javascript
app.use(async (ctx, next) => {
  if (ctx.path === '/heavy-calc') {
    // 同步大计算：阻塞事件循环，所有请求挂起
    const arr = Array.from({ length: 10000000 }, () => Math.random());
    arr.sort();
    ctx.body = '计算完成';
  }
  await next();
});
```

### 解决方案
#### 方案1：try/finally 确保资源释放
```javascript
app.use(async (ctx, next) => {
  if (ctx.path === '/forget-release') {
    await lock.acquire('lockC');
    try {
      throw new Error('业务异常');
    } catch (e) {
      throw e;
    } finally {
      // 无论是否出错，都释放锁
      lock.release('lockC');
    }
  }
  await next();
});
```

#### 方案2：使用 Worker Threads 避免阻塞事件循环
将同步耗时操作放到子线程执行：
```javascript
const { Worker } = require('worker_threads');

app.use(async (ctx, next) => {
  if (ctx.path === '/heavy-calc') {
    const result = await new Promise((resolve, reject) => {
      // 创建子线程执行计算
      const worker = new Worker(`
        const arr = Array.from({ length: 10000000 }, () => Math.random());
        arr.sort();
        process.send('计算完成');
      `, { eval: true });
      worker.on('message', resolve);
      worker.on('error', reject);
    });
    ctx.body = result;
  }
  await next();
});
```

---

## 核心解决原则
1. **统一顺序**：多资源竞争时，固定获取顺序；
2. **超时机制**：给锁/事务添加超时，避免永久等待；
3. **确保释放**：使用 try/finally 保证资源（锁、事务）释放；
4. **缩短持有**：减少锁/事务的持有时间；
5. **避免阻塞**：同步耗时操作放到子线程；
6. **重试机制**：数据库死锁捕获后自动重试。

