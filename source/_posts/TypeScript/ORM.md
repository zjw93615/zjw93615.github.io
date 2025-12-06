---
title: Sequelize 核心 + TiDB/MySQL 驱动（TiDB 兼容 mysql2 驱动）
tags:
  - TypeScript
  - Sequelize
  - TiDB
  - Koa
categories:
  - TypeScript
date: 2025-12-06 21:18:21
---

### Koa 中简化 TiDB 操作：ORM 工具选型 + 实战（避免手写 SQL）
TiDB 兼容 MySQL 协议，因此 Node.js 生态中适配 MySQL 的 ORM（对象关系映射）工具均可直接用于 TiDB，无需手写 SQL，大幅降低操作复杂度。以下推荐 **Sequelize**（最成熟、适配 Koa 异步场景）和 **Prisma**（新一代类型安全 ORM）两种方案，结合 Koa 实战讲解，兼顾易用性与高并发适配。

## 一、方案 1：Sequelize（成熟稳定，适配 Koa 异步）
Sequelize 是 Node.js 中最主流的 MySQL ORM，支持 Promise/async-await，完美适配 Koa 异步逻辑，可通过「模型定义 + 链式调用」替代手写 SQL，且内置连接池、事务、批量操作等特性，适配 TiDB 高并发场景。

### 1. 核心依赖安装
```bash
# Sequelize 核心 + TiDB/MySQL 驱动（TiDB 兼容 mysql2 驱动）
npm install sequelize mysql2
```

### 2. TiDB 连接配置（全局初始化）
```javascript
// utils/sequelize.js
const { Sequelize } = require('sequelize');

// 初始化 Sequelize（内置连接池，替代手动创建的 mysql2 连接池）
const sequelize = new Sequelize('game_activity', 'root', 'your-tidb-password', {
  host: 'tidb-cluster-host',
  port: 4000, // TiDB 默认端口
  dialect: 'mysql', // TiDB 兼容 MySQL 方言
  // 连接池配置（适配 7000+ QPS）
  pool: {
    max: 100, // 最大连接数
    min: 10, // 最小空闲连接数
    acquire: 30000, // 连接超时时间
    idle: 10000 // 空闲连接回收时间
  },
  // TiDB 特有优化
  dialectOptions: {
    enableKeepAlive: true,
    keepAliveInitialDelay: 30000
  },
  // 关闭日志（生产环境），开发环境可开启
  logging: process.env.NODE_ENV === 'development' ? console.log : false
});

// 测试连接（可选）
sequelize.authenticate()
  .then(() => console.log('TiDB 连接成功（Sequelize）'))
  .catch(err => console.error('TiDB 连接失败：', err));

module.exports = sequelize;
```

### 3. 定义数据模型（替代建表 SQL）
通过模型定义映射 TiDB 表结构，无需手写 `CREATE TABLE`，支持字段类型、索引、默认值等配置：
```javascript
// models/Activity.js
const { DataTypes, Model } = require('sequelize');
const sequelize = require('../utils/sequelize');

// 定义活动模型（对应 activity 表）
class Activity extends Model {}
Activity.init({
  // 字段定义（无需手写 SQL，自动映射 TiDB 表）
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: '活动名称'
  },
  start_time: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: '开始时间'
  },
  end_time: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: '结束时间'
  },
  remain_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '剩余参与次数'
  },
  status: {
    type: DataTypes.TINYINT,
    defaultValue: 1,
    comment: '1-活跃 2-结束'
  }
}, {
  sequelize, // 关联 Sequelize 实例
  tableName: 'activity', // 对应 TiDB 表名
  indexes: [
    // 索引定义（替代 CREATE INDEX）
    { name: 'idx_activity_time', fields: ['start_time', 'end_time'] },
    { name: 'idx_status', fields: ['status'] }
  ],
  timestamps: false // 关闭自动添加 createAt/updateAt 字段（按需开启）
});

// 定义用户参与模型（对应 user_activity 表）
class UserActivity extends Model {}
UserActivity.init({
  user_id: {
    type: DataTypes.BIGINT,
    allowNull: false,
    comment: '玩家ID'
  },
  activity_id: {
    type: DataTypes.BIGINT,
    allowNull: false,
    comment: '活动ID'
  },
  join_time: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment: '参与时间'
  },
  status: {
    type: DataTypes.TINYINT,
    defaultValue: 1,
    comment: '1-成功 2-失败'
  }
}, {
  sequelize,
  tableName: 'user_activity',
  indexes: [
    { name: 'uk_user_activity', fields: ['user_id', 'activity_id'], unique: true }, // 唯一索引
    { name: 'idx_activity_join', fields: ['activity_id', 'join_time'] }
  ],
  timestamps: false
});

// 模型关联（可选，如用户参与关联活动）
UserActivity.belongsTo(Activity, { foreignKey: 'activity_id', targetKey: 'id' });

module.exports = { Activity, UserActivity };
```

### 4. Koa 中使用模型操作 TiDB（无手写 SQL）
通过 Sequelize 链式调用实现 CRUD，替代手写 SELECT/INSERT/UPDATE/DELETE：
```javascript
// routes/activity.js
const Router = require('koa-router');
const router = new Router({ prefix: '/api/activity' });
const { Activity, UserActivity } = require('../models/Activity');
const redis = require('../utils/redis');

// 1. 查询活动配置（替代 SELECT * FROM activity WHERE id = ?）
router.get('/config/:id', async (ctx) => {
  const activityId = ctx.params.id;
  // 优先查缓存，缓存未命中则查 DB（Sequelize 链式查询）
  const cacheConfig = await redis.get(`activity:config:${activityId}`);
  if (cacheConfig) {
    ctx.body = { data: JSON.parse(cacheConfig) };
    return;
  }

  // Sequelize 查询：无手写 SQL
  const activity = await Activity.findOne({
    where: { id: activityId, status: 1 }, // 条件过滤
    attributes: ['id', 'name', 'start_time', 'end_time', 'remain_count'] // 仅返回需要的字段
  });

  if (!activity) {
    ctx.status = 404;
    ctx.body = { msg: '活动不存在' };
    return;
  }

  // 写入缓存
  await redis.set(`activity:config:${activityId}`, JSON.stringify(activity), 'EX', 3600);
  ctx.body = { data: activity };
});

// 2. 用户参与活动（事务 + 无手写 SQL）
router.post('/join', async (ctx) => {
  const { activityId, userId } = ctx.request.body;
  // 幂等性校验
  const isJoined = await redis.get(`activity:join:${activityId}:${userId}`);
  if (isJoined) {
    ctx.body = { msg: '已参与该活动' };
    return;
  }

  try {
    // Sequelize 事务（替代手动 BEGIN/COMMIT/ROLLBACK）
    await sequelize.transaction(async (t) => {
      // 扣减活动剩余次数（替代 UPDATE activity SET remain_count = remain_count -1 WHERE id = ? AND remain_count > 0）
      const [updated] = await Activity.update(
        { remain_count: sequelize.literal('remain_count - 1') }, // 自减
        { where: { id: activityId, remain_count: { [Op.gt]: 0 } }, transaction: t }
      );

      if (updated === 0) {
        throw new Error('活动参与次数已用完');
      }

      // 记录用户参与（替代 INSERT INTO user_activity VALUES (?, ?, NOW(), 1)）
      await UserActivity.create({
        user_id: userId,
        activity_id: activityId,
        status: 1
      }, { transaction: t });
    });

    // 标记幂等
    await redis.set(`activity:join:${activityId}:${userId}`, '1', 'EX', 86400);
    ctx.body = { msg: '参与成功' };
  } catch (err) {
    ctx.status = 500;
    ctx.body = { msg: err.message };
  }
});

module.exports = router;
```

### 5. 常用操作示例（无手写 SQL）
| 操作类型 | Sequelize 代码（无 SQL）                                                        | 等价手写 SQL                                                         |
| -------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 批量插入 | `await UserActivity.bulkCreate([{user_id:1, activity_id:1}, ...])`              | `INSERT INTO user_activity VALUES (...), (...)`                      |
| 条件更新 | `await Activity.update({status:2}, {where: {end_time: {[Op.lt]: new Date()}}})` | `UPDATE activity SET status=2 WHERE end_time < NOW()`                |
| 分页查询 | `await Activity.findAndCountAll({where: {status:1}, limit:10, offset:20})`      | `SELECT COUNT(*), * FROM activity WHERE status=1 LIMIT 10 OFFSET 20` |
| 关联查询 | `await UserActivity.findOne({where: {user_id:1}, include: [Activity]})`         | `SELECT * FROM user_activity JOIN activity ON ... WHERE user_id=1`   |

## 二、方案 2：Prisma（新一代类型安全 ORM）
Prisma 是更现代的 ORM，通过「Schema 文件定义模型 + 自动生成客户端」实现类型安全的数据库操作，代码更简洁，适合 TypeScript 项目，同样适配 TiDB（MySQL 兼容）。

### 1. 核心步骤（极简版）
#### （1）安装依赖 + 初始化
```bash
npm install prisma --save-dev
npm install @prisma/client
npx prisma init --datasource-provider mysql
```

#### （2）配置 Prisma Schema（prisma/schema.prisma）
```prisma
datasource db {
  provider = "mysql"
  url      = "mysql://root:your-tidb-password@tidb-cluster-host:4000/game_activity"
}

// 定义活动模型
model Activity {
  id           BigInt    @id @default(autoincrement())
  name         String    @db.VarChar(100)
  startTime    DateTime  @map("start_time")
  endTime      DateTime  @map("end_time")
  remainCount  Int       @default(0) @map("remain_count")
  status       Int       @default(1)
  userActivity UserActivity[]

  @@map("activity")
  @@index([startTime, endTime], name: "idx_activity_time")
}

// 定义用户参与模型
model UserActivity {
  id          BigInt    @id @default(autoincrement())
  userId      BigInt    @map("user_id")
  activityId  BigInt    @map("activity_id")
  joinTime    DateTime  @default(now()) @map("join_time")
  status      Int       @default(1)
  activity    Activity  @relation(fields: [activityId], references: [id])

  @@map("user_activity")
  @@unique([userId, activityId], name: "uk_user_activity")
  @@index([activityId, joinTime], name: "idx_activity_join")
}
```

#### （3）生成客户端 + 同步模型到 TiDB
```bash
npx prisma migrate dev --name init # 同步模型到 TiDB（自动建表）
npx prisma generate # 生成 TypeScript 客户端
```

#### （4）Koa 中使用 Prisma（无手写 SQL）
```javascript
// utils/prisma.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  // 连接池配置
  datasources: {
    db: {
      poolSize: 100
    }
  }
});

module.exports = prisma;

// routes/activity.js
const router = new Router({ prefix: '/api/activity' });
const prisma = require('../utils/prisma');

// 查询活动配置（Prisma 语法）
router.get('/config/:id', async (ctx) => {
  const activity = await prisma.activity.findUnique({
    where: { id: BigInt(ctx.params.id), status: 1 },
    select: { id: true, name: true, remainCount: true } // 仅返回指定字段
  });
  ctx.body = { data: activity };
});

// 用户参与活动（事务）
router.post('/join', async (ctx) => {
  const { activityId, userId } = ctx.request.body;
  try {
    // Prisma 事务
    await prisma.$transaction(async (tx) => {
      // 扣减次数
      const activity = await tx.activity.update({
        where: { id: BigInt(activityId), remainCount: { gt: 0 } },
        data: { remainCount: { decrement: 1 } } // 自减
      });
      if (!activity) throw new Error('次数不足');

      // 记录参与
      await tx.userActivity.create({
        data: { userId: BigInt(userId), activityId: BigInt(activityId) }
      });
    });
    ctx.body = { msg: '参与成功' };
  } catch (err) {
    ctx.body = { msg: err.message };
  }
});
```

## 三、核心优势 & 选型建议
| 特性     | Sequelize                   | Prisma                   |
| -------- | --------------------------- | ------------------------ |
| 上手难度 | 低（文档全，学习成本低）    | 中（需理解 Schema/生成） |
| 类型安全 | 弱（需手动定义类型）        | 强（自动生成 TS 类型）   |
| 性能     | 中（成熟连接池）            | 高（编译时优化查询）     |
| 适配 Koa | 完美（Promise/async-await） | 完美（异步客户端）       |
| 批量操作 | 支持                        | 支持                     |
| 事务     | 支持（手动/自动）           | 支持（$transaction）     |

### 选型建议：
- 快速开发/JavaScript 项目：选 **Sequelize**，成熟稳定，无需额外生成步骤；
- TypeScript 项目/追求类型安全：选 **Prisma**，代码更简洁，减少运行时错误；
- 高并发游戏活动场景：两者均可，核心是配置好连接池，避免频繁创建连接。

## 四、简化操作的额外技巧
### 1. 封装通用 CRUD 方法
基于 ORM 封装通用的查询/新增/更新方法，进一步减少重复代码：
```javascript
// utils/db.js
const { Activity } = require('../models/Activity');

// 通用查询方法
async function getById(model, id) {
  return await model.findOne({ where: { id } });
}

// 通用批量更新
async function batchUpdate(model, data, where) {
  return await model.update(data, { where });
}

// 使用：查询活动
const activity = await getById(Activity, 123);
```

### 2. 利用 ORM 内置缓存（结合 Redis）
Sequelize/Prisma 可结合 Redis 实现二级缓存，ORM 查 DB 后自动写入 Redis，无需手动处理：
```javascript
// Sequelize 缓存插件示例
const sequelizeCache = require('sequelize-cache');
sequelizeCache(sequelize, {
  client: redis,
  prefix: 'sequelize:',
  ttl: 3600
});

// 查询自动缓存
const activity = await Activity.findOne({
  where: { id: 123 },
  cache: true // 自动缓存结果
});
```
