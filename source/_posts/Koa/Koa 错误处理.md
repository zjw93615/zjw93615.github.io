---
title: 可选（日志按天分割）：npm install winston-daily-rotate-file
tags:
  - Koa
  - 性能优化
categories:
  - Koa
date: 2025-12-06 21:18:21
---

### Koa 错误处理实现：全局兜底 + 精细化区分
以下是完整的 Koa 错误处理方案，涵盖**自定义错误类型、全局错误中间件、结构化日志、异步错误兜底**，所有代码可直接运行，且严格遵循「业务错误暴露详情、系统错误隐藏详情」的核心要求。

### 一、环境准备
先安装依赖：
```bash
npm install koa koa-router koa-body winston http-errors
# 可选（日志按天分割）：npm install winston-daily-rotate-file
```

### 二、目录结构
```
src/
├── errors/           # 自定义错误类
│   └── customError.js
├── logger/           # 结构化日志配置
│   └── index.js
├── middleware/       # 全局错误中间件
│   └── errorHandler.js
├── routes/           # 示例路由（模拟错误场景）
│   └── demo.js
└── app.js            # 入口文件
```

### 三、核心代码实现

#### 1. 自定义错误类（区分业务/系统错误）
`src/errors/customError.js`：定义标准化的错误基类，明确区分「业务错误」和「系统错误」，便于后续精细化处理。
```javascript
/**
 * 自定义错误基类
 * @param {number} code 错误码（如400/403/500）
 * @param {string} message 错误描述
 */
class CustomError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // 错误码（HTTP状态码/业务码）
    this.name = this.constructor.name; // 错误类型名称（便于日志区分）
    Error.captureStackTrace(this, this.constructor); // 捕获堆栈信息（溯源用）
  }
}

/**
 * 业务错误：参数错误、权限不足等，对外暴露具体信息
 * 示例：new BusinessError(400, "用户ID必须为数字")
 */
class BusinessError extends CustomError {
  constructor(code, message) {
    super(code, message);
  }
}

/**
 * 系统错误：数据库异常、服务熔断等，对外隐藏具体信息
 * 示例：new SystemError(500, "数据库连接超时")
 */
class SystemError extends CustomError {
  constructor(code = 500, message) {
    super(code, message);
  }
}

module.exports = { CustomError, BusinessError, SystemError };
```

#### 2. 结构化日志配置（winston）
`src/logger/index.js`：记录错误的完整上下文（请求参数、IP、堆栈、时间），输出到文件/控制台，便于问题溯源。
```javascript
const winston = require('winston');
// 可选：日志按天分割（需安装winston-daily-rotate-file）
// const DailyRotateFile = require('winston-daily-rotate-file');

const { combine, timestamp, printf, json } = winston.format;

// 自定义日志格式：结构化输出，包含所有上下文信息
const logFormat = printf(({ level, message, timestamp, ...meta }) => {
  return JSON.stringify({
    time: timestamp,       // 错误发生时间
    level: level,          // 日志级别（error/warn/info）
    message: message,      // 错误核心描述
    ...meta                // 扩展字段：请求参数、IP、堆栈等
  });
});

// 创建logger实例
const logger = winston.createLogger({
  level: 'error', // 仅记录错误级别日志
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), // 时间格式
    json(), // 结构化JSON输出
    logFormat
  ),
  transports: [
    // 输出到错误日志文件
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error' 
    }),
    // 开发环境：控制台彩色输出（便于调试）
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(), // 彩色字体
        logFormat
      )
    })
    // 可选：日志按天分割（替代上面的File transport）
    // new DailyRotateFile({
    //   filename: 'logs/error-%DATE%.log',
    //   datePattern: 'YYYY-MM-DD',
    //   level: 'error'
    // })
  ]
});

module.exports = logger;
```

#### 3. 全局错误中间件（核心）
`src/middleware/errorHandler.js`：捕获所有同步/异步错误，统一返回格式，区分业务/系统错误处理逻辑。
```javascript
const logger = require('../logger');
const { BusinessError, SystemError } = require('../errors/customError');

/**
 * Koa全局错误处理中间件
 * 作用：1. 捕获所有同步/异步错误 2. 统一响应格式 3. 区分业务/系统错误 4. 记录错误日志
 */
const errorHandler = async (ctx, next) => {
  try {
    await next(); // 执行后续中间件/路由（洋葱模型：包裹所有业务逻辑）
  } catch (err) {
    // 1. 构建错误日志的完整上下文（便于溯源）
    const errorContext = {
      request: {
        method: ctx.method,    // 请求方法（GET/POST）
        url: ctx.url,          // 请求URL
        params: ctx.params,    // 路由参数
        query: ctx.query,      // URL查询参数
        body: ctx.request.body,// 请求体
        ip: ctx.ip             // 请求IP
      },
      stack: err.stack,        // 错误堆栈（关键：定位代码行）
      errorName: err.name,     // 错误类型名称
      errorMessage: err.message// 错误原始描述
    };

    // 2. 记录结构化错误日志
    logger.error('Request Error', errorContext);

    // 3. 统一响应格式（禁止暴露系统错误详情）
    const response = {
      code: 500,
      msg: '服务暂不可用', // 系统错误默认提示
      data: null
    };

    // 4. 精细化区分错误类型
    if (err instanceof BusinessError) {
      // 业务错误：返回具体错误码和描述（对外暴露）
      response.code = err.code;
      response.msg = err.message;
    } else if (err instanceof SystemError) {
      // 系统错误：仅返回错误码，隐藏具体描述（msg保持默认）
      response.code = err.code;
    } else {
      // 未知错误（原生Error）：按系统错误处理，日志记录原始信息
      logger.error('Unknown Error', { ...errorContext, rawError: err });
    }

    // 5. 设置响应状态码 + 返回统一格式
    ctx.status = err.code || 500;
    ctx.body = response;
  }
};

module.exports = errorHandler;
```

#### 4. 示例路由（模拟错误场景）
`src/routes/demo.js`：模拟不同错误场景（参数错误、权限不足、数据库异常），验证错误处理逻辑。
```javascript
const Router = require('koa-router');
const router = new Router();
const { BusinessError, SystemError } = require('../errors/customError');

// 场景1：参数错误（业务错误）
router.get('/user/:id', async (ctx) => {
  const { id } = ctx.params;
  if (!/^\d+$/.test(id)) {
    // 抛出业务错误：对外暴露具体原因
    throw new BusinessError(400, '用户ID必须为数字');
  }
  ctx.body = { code: 200, msg: 'success', data: { id } };
});

// 场景2：权限不足（业务错误）
router.post('/admin/delete', async (ctx) => {
  const { role } = ctx.request.body;
  if (role !== 'admin') {
    throw new BusinessError(403, '权限不足，仅管理员可操作');
  }
  ctx.body = { code: 200, msg: '删除成功', data: null };
});

// 场景3：数据库异常（系统错误）
router.get('/data/list', async (ctx) => {
  try {
    // 模拟数据库查询失败
    throw new Error('数据库连接超时（原生错误）');
  } catch (dbErr) {
    // 包装为系统错误：对外隐藏具体原因，日志记录详情
    throw new SystemError(500, dbErr.message);
  }
});

module.exports = router;
```

#### 5. 入口文件（整合所有模块 + 异步错误兜底）
`src/app.js`：注册中间件/路由，配置 Koa 内置的 `error` 事件兜底（防止未捕获的异步错误导致进程崩溃）。
```javascript
const Koa = require('koa');
const app = new Koa();
const koaBody = require('koa-body'); // 解析请求体（POST接口需要）
const router = require('./routes/demo');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./logger');

// 1. 解析请求体（JSON/表单）
app.use(koaBody());

// 2. 全局错误处理中间件（必须放在所有路由之前！）
app.use(errorHandler);

// 3. 注册业务路由
app.use(router.routes()).use(router.allowedMethods());

// 4. Koa内置error事件：兜底捕获未被中间件捕获的错误（终极兜底）
app.on('error', (err, ctx) => {
  const errorContext = {
    request: ctx ? {
      method: ctx.method,
      url: ctx.url,
      ip: ctx.ip
    } : '无请求上下文', // 无ctx时（如启动阶段错误）
    stack: err.stack,
    errorMessage: err.message
  };
  // 记录兜底错误日志
  logger.error('Uncaught Koa Error (终极兜底)', errorContext);
});

// 启动服务
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

### 四、测试验证
启动服务：`node src/app.js`，访问以下接口验证效果：

| 接口                                     | 响应结果（客户端）                                  | 日志记录（服务端）                  |
| ---------------------------------------- | --------------------------------------------------- | ----------------------------------- |
| GET /user/abc                            | {code:400,msg:"用户ID必须为数字",data:null}         | 包含请求参数、IP、堆栈、错误描述    |
| POST /admin/delete（body {role:"user"}） | {code:403,msg:"权限不足，仅管理员可操作",data:null} | 完整上下文 + 业务错误详情           |
| GET /data/list                           | {code:500,msg:"服务暂不可用",data:null}             | 包含“数据库连接超时”原始错误 + 堆栈 |

### 五、关键注意事项
1. **中间件顺序**：错误中间件必须放在所有路由/业务中间件之前（洋葱模型特性，确保包裹所有逻辑）；
2. **异步错误捕获**：Koa 中 `async/await` 的错误会被 `try/catch` 捕获，`app.on('error')` 处理「未被中间件捕获的错误」（如中间件外的异步操作）；
3. **日志溯源**：堆栈信息（`err.stack`）是定位问题的核心，必须记录；
4. **生产环境优化**：日志可输出到 ELK 平台（Logstash 收集 + Kibana 可视化），而非仅本地文件。
