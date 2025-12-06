---
title: kos安全防护
tags:
categories:
  - 安全
date: 2025-12-06 21:18:21
---

### 一、基础安全配置：筑牢HTTP层防护
#### 1. koa-helmet：强化HTTP安全头（核心防护XSS/点击劫持/中间人攻击）
`koa-helmet` 是对 `helmet` 的Koa适配，通过设置HTTP响应头减少常见Web漏洞，以下是企业级核心配置及注意事项：
- **核心配置示例**：
  ```javascript
  const Koa = require('koa');
  const helmet = require('koa-helmet');
  const app = new Koa();

  // 全量启用基础防护（推荐）+ 精细化调整关键头
  app.use(helmet({
    // 防XSS：启用X-XSS-Protection头，检测到XSS攻击时阻止页面加载
    xssFilter: { setOnOldIE: true }, 
    // 防点击劫持：禁止页面被嵌入iframe（如需允许特定域名，用allow-from）
    frameguard: { action: 'deny' }, 
    // 内容安全策略（CSP）：严格限制资源加载来源（核心！防止恶意脚本注入）
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], // 默认仅允许自身域名加载资源
        scriptSrc: ["'self'", 'trusted-cdn.com'], // 脚本仅允许自身+可信CDN
        styleSrc: ["'self'", "'unsafe-inline'"], // 样式允许内联（根据业务调整）
        imgSrc: ["'self'", 'data:', 'trusted-img-cdn.com'], // 图片允许自身+dataURI+可信CDN
        connectSrc: ["'self'", 'api.your-domain.com'], // AJAX请求仅允许自身API
        objectSrc: ["'none'"], // 禁止嵌入插件（如Flash）
        upgradeInsecureRequests: [], // 强制HTTP请求转为HTTPS
      }
    },
    // 强制HTTPS：HSTS头，告知浏览器长期使用HTTPS（有效期1年，包含子域名）
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    // 禁止浏览器猜测MIME类型（防止恶意文件被解析）
    noSniff: true,
    // 移除X-Powered-By头（隐藏Koa/Node.js版本，避免针对性攻击）
    hidePoweredBy: { setTo: 'PHP/7.4.3' } // 伪装服务器类型（可选）
  }));
  ```
- **注意事项**：
  - CSP规则需根据业务灵活调整，过度严格会导致正常功能异常（如富文本编辑器需放宽`scriptSrc`）；
  - HSTS配置后，若需回退HTTP需提前删除配置并等待`maxAge`过期，否则浏览器强制HTTPS；
  - 不要完全禁用`xssFilter`，老版本IE仍需依赖该防护。

#### 2. koa2-cors：精细化跨域防护（禁止宽松配置）
跨域漏洞的核心风险是`origin: *`允许任意域名请求，企业级需严格限定白名单，配置示例：
```javascript
const cors = require('koa2-cors');

app.use(cors({
  // 核心：仅允许指定域名跨域（支持动态判断）
  origin: (ctx) => {
    const whiteList = ['https://www.your-domain.com', 'https://admin.your-domain.com'];
    const requestOrigin = ctx.header.origin;
    // 非白名单域名拒绝跨域
    return whiteList.includes(requestOrigin) ? requestOrigin : false;
  },
  // 允许的请求方法（仅开放业务需要的方法，禁止*）
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  // 允许的请求头（仅开放业务需要的头，禁止*）
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  // 允许携带Cookie（如需跨域鉴权需开启，配合前端withCredentials）
  credentials: true,
  // 预检请求缓存时间（减少OPTIONS请求次数）
  maxAge: 86400,
  // 暴露给前端的响应头（仅开放必要的）
  exposeHeaders: ['Content-Length', 'X-Token']
}));
```
- **注意事项**：
  - 禁止设置`origin: *`+`credentials: true`（浏览器会直接阻止）；
  - 预检请求（OPTIONS）需放行，不要添加鉴权中间件，避免拦截；
  - 生产环境需移除本地开发域名（如`http://localhost:3000`）。

#### 3. koa-ratelimit：接口限流（单机/分布式）
防止暴力请求（如密码爆破、批量接口调用），企业级需结合Redis实现分布式限流（多进程/多服务器共享限流状态）：
- **单机版配置（开发环境）**：
  ```javascript
  const ratelimit = require('koa-ratelimit');
  const Redis = require('ioredis');
  const redis = new Redis({ host: '127.0.0.1', port: 6379 });

  // 全局限流：IP维度，1分钟最多100次请求
  app.use(ratelimit({
    driver: 'redis',
    db: redis,
    duration: 60 * 1000, // 限流时间窗口（毫秒）
    errorMessage: '请求过于频繁，请1分钟后重试',
    id: (ctx) => ctx.ip, // 限流粒度：IP（可改为用户ID提升精准度）
    headers: {
      remaining: 'X-RateLimit-Remaining', // 剩余请求数
      reset: 'X-RateLimit-Reset', // 重置时间
      total: 'X-RateLimit-Total' // 总请求数
    },
    max: 100, // 时间窗口内最大请求数
    disableHeader: false,
    whitelist: (ctx) => {
      // 白名单：内部IP/管理员IP不限流
      return ['192.168.1.100', '10.0.0.5'].includes(ctx.ip);
    },
    blacklist: (ctx) => {
      // 黑名单：恶意IP直接拒绝
      return ['1.2.3.4', '5.6.7.8'].includes(ctx.ip);
    }
  }));
  ```
- **分布式限流注意事项**：
  - 必须使用Redis作为存储（单机内存存储无法跨进程/服务器共享）；
  - 限流粒度：核心接口（如登录、支付）建议按“用户ID+IP”双重限流，普通接口按IP；
  - 避免限流规则过严（如1分钟5次）导致正常用户体验下降，需结合业务压测调整；
  - 限流提示需友好，避免泄露限流规则（如不返回“剩余5次请求”，仅返回“请求频繁”）。

### 二、鉴权与数据安全：核心业务防护
#### 1. JWT鉴权：避免token漏洞
JWT是企业级接口鉴权的主流方案，核心风险是token泄露、过期机制缺失，配置示例及注意事项：
- **核心配置（生成/验证token）**：
  ```javascript
  const jwt = require('jsonwebtoken');
  const SECRET = process.env.JWT_SECRET; // 从环境变量读取密钥（禁止硬编码）
  const ACCESS_TOKEN_EXPIRE = '15m'; // 访问令牌过期时间（短期，15分钟）
  const REFRESH_TOKEN_EXPIRE = '7d'; // 刷新令牌过期时间（长期，7天）

  // 生成token（登录成功后）
  const generateToken = (userId) => {
    const accessToken = jwt.sign({ userId }, SECRET, { expiresIn: ACCESS_TOKEN_EXPIRE });
    const refreshToken = jwt.sign({ userId, type: 'refresh' }, SECRET, { expiresIn: REFRESH_TOKEN_EXPIRE });
    return { accessToken, refreshToken };
  };

  // 验证token中间件
  const authMiddleware = async (ctx, next) => {
    try {
      const token = ctx.headers.authorization?.split(' ')[1];
      if (!token) throw new Error('未携带令牌');
      // 验证token（自动校验过期时间）
      const payload = jwt.verify(token, SECRET);
      ctx.state.userId = payload.userId; // 挂载用户ID到ctx
      await next();
    } catch (err) {
      ctx.status = 401;
      ctx.body = { code: 401, msg: '令牌无效或已过期' };
    }
  };

  // 刷新token接口（避免用户频繁登录）
  app.post('/refresh-token', async (ctx) => {
    const { refreshToken } = ctx.request.body;
    if (!refreshToken) {
      ctx.status = 401;
      ctx.body = { code: 401, msg: '刷新令牌缺失' };
      return;
    }
    try {
      const payload = jwt.verify(refreshToken, SECRET);
      if (payload.type !== 'refresh') throw new Error('刷新令牌无效');
      // 生成新的accessToken
      const newAccessToken = jwt.sign({ userId: payload.userId }, SECRET, { expiresIn: ACCESS_TOKEN_EXPIRE });
      ctx.body = { code: 200, data: { accessToken: newAccessToken } };
    } catch (err) {
      ctx.status = 401;
      ctx.body = { code: 401, msg: '刷新令牌过期，请重新登录' };
    }
  });
  ```
- **注意事项**：
  - 密钥（SECRET）必须足够复杂（至少32位随机字符串），并通过环境变量/配置中心管理；
  - token过期策略：accessToken短期（15-30分钟），refreshToken长期（7-14天），避免token泄露后被长期滥用；
  - 禁止将敏感信息（如密码、手机号）存入JWT（JWT仅做Base64编码，未加密，可被解码）；
  - token传输必须通过HTTPS，前端建议将refreshToken存入httpOnly cookie（防止XSS窃取），accessToken存入内存（如Vuex/Redux）；
  - 实现token黑名单机制（如用户退出登录后，将token加入Redis黑名单，验证时先查黑名单）。

#### 2. 密码加密：bcrypt加盐哈希
禁止明文/简单加密（如MD5）存储密码，bcrypt是行业标准，配置示例：
```javascript
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 12; // 加盐轮数（10-12为宜，过高影响性能，过低易被破解）

// 密码哈希（注册/修改密码时）
const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  return bcrypt.hash(password, salt);
};

// 密码验证（登录时）
const verifyPassword = async (inputPassword, hashedPassword) => {
  return bcrypt.compare(inputPassword, hashedPassword);
};

// 示例：注册用户
app.post('/register', async (ctx) => {
  const { username, password } = ctx.request.body;
  const hashedPwd = await hashPassword(password);
  // 存入数据库（仅存哈希值，不存明文）
  await User.create({ username, password: hashedPwd });
  ctx.body = { code: 200, msg: '注册成功' };
});
```
- **注意事项**：
  - 加盐轮数不要低于10（bcrypt默认10，12是企业级推荐值）；
  - 禁止使用MD5/SHA1等无加盐哈希（彩虹表可轻松破解）；
  - 密码验证时，禁止将用户输入的密码哈希后与数据库对比（需用`bcrypt.compare`，自动处理加盐逻辑）。

#### 3. 参数校验：防止XSS/SQL注入
所有入参（query/body/params）必须严格校验，推荐`joi`（易用）或`ajv`（高性能），示例：
```javascript
const Joi = require('joi');
const xss = require('xss'); // 额外XSS过滤（兜底）

// 定义校验规则（登录接口）
const loginSchema = Joi.object({
  username: Joi.string().alphanum().min(6).max(20).required(), // 仅允许字母数字，6-20位
  password: Joi.string().min(8).max(20).required().pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/), // 密码需包含大小写+数字
  captcha: Joi.string().length(4).required() // 验证码4位
});

// 参数校验中间件
const validateParams = (schema) => async (ctx, next) => {
  try {
    // 校验入参
    await schema.validateAsync(ctx.request.body, { abortEarly: false });
    // XSS过滤（兜底，即使校验通过也过滤危险字符）
    for (const key in ctx.request.body) {
      if (typeof ctx.request.body[key] === 'string') {
        ctx.request.body[key] = xss(ctx.request.body[key]);
      }
    }
    await next();
  } catch (err) {
    ctx.status = 400;
    ctx.body = { code: 400, msg: `参数错误：${err.details.map(d => d.message).join(', ')}` };
  }
};

// 使用校验中间件
app.post('/login', validateParams(loginSchema), async (ctx) => {
  // 处理登录逻辑（入参已校验+XSS过滤）
});
```
- **数据库操作防护**：
  - 优先使用ORM（Sequelize/TypeORM），通过参数绑定防止SQL注入：
    ```javascript
    // 安全：ORM参数绑定
    const user = await User.findOne({ where: { username: ctx.request.body.username } });
    // 禁止：手写SQL（易注入）
    // const [user] = await db.query(`SELECT * FROM users WHERE username = '${ctx.request.body.username}'`);
    ```
  - 禁止使用`SELECT *`，仅查询业务需要的字段（减少敏感信息泄露风险）；
  - 对用户输入的查询条件（如搜索关键词）做转义处理，即使使用ORM也需校验。

### 三、防攻击防护：针对性漏洞拦截
#### 1. CSRF防护（koa-csrf）
CSRF攻击是利用用户已登录的身份发起恶意请求，配置示例：
```javascript
const csrf = require('koa-csrf');

app.use(csrf({
  cookieKey: 'csrfToken', // 存储csrf token的cookie名
  secret: process.env.CSRF_SECRET, // 密钥
  expires: 86400, // token有效期1天
  disableQuery: true // 禁止从query中获取token（仅允许header/body）
}));

// 前端获取csrf token接口
app.get('/get-csrf-token', async (ctx) => {
  ctx.body = { code: 200, data: { csrfToken: ctx.csrf } };
});

// 敏感接口（如修改密码）需校验csrf token
app.post('/change-password', async (ctx) => {
  try {
    // 自动校验csrf token（koa-csrf会检查header的X-CSRF-Token或body的csrfToken）
    await ctx.verifyCsrf();
    // 处理修改密码逻辑
  } catch (err) {
    ctx.status = 403;
    ctx.body = { code: 403, msg: 'CSRF验证失败' };
  }
});
```
- **注意事项**：
  - GET/HEAD/OPTIONS等“安全方法”无需校验CSRF（仅校验POST/PUT/DELETE）；
  - CSRF token需与用户会话绑定（禁止全局通用token）；
  - 前后端分离场景下，CSRF token需通过接口返回，前端请求时携带在header（X-CSRF-Token）中。

#### 2. 敏感接口二次校验
核心敏感接口（支付、用户信息修改、提现）需在鉴权/CSRF基础上增加二次校验：
- 支付接口：添加短信验证码/图形验证码/人脸验证；
- 用户密码修改：验证旧密码+短信验证码；
- 账户提现：验证支付密码+短信验证码；
- 示例（支付接口二次校验）：
  ```javascript
  app.post('/pay', authMiddleware, async (ctx) => {
    const { amount, orderId, smsCode } = ctx.request.body;
    // 1. 校验订单归属（订单所属用户=当前登录用户）
    const order = await Order.findOne({ where: { id: orderId, userId: ctx.state.userId } });
    if (!order) {
      ctx.status = 400;
      ctx.body = { code: 400, msg: '订单不存在' };
      return;
    }
    // 2. 校验短信验证码
    const verifyResult = await verifySmsCode(ctx.state.userId, smsCode);
    if (!verifyResult) {
      ctx.status = 400;
      ctx.body = { code: 400, msg: '验证码错误' };
      return;
    }
    // 3. 执行支付逻辑
    await PayService.pay(ctx.state.userId, orderId, amount);
    ctx.body = { code: 200, msg: '支付成功' };
  });
  ```

#### 3. 其他防攻击措施
- **限制请求体大小**：防止超大请求体攻击（如上传100MB文件）：
  ```javascript
  const koaBody = require('koa-body');
  app.use(koaBody({
    jsonLimit: '1mb', // JSON请求体最大1MB
    formLimit: '500kb', // 表单请求体最大500KB
    multipart: true, // 允许文件上传
    formidable: {
      maxFileSize: 5 * 1024 * 1024 // 文件上传最大5MB
    }
  }));
  ```
- **防止HTTP参数污染**：如`?id=1&id=2`，Koa默认取最后一个值，需校验参数唯一性；
- **定期安全扫描**：使用`npm audit`检测依赖漏洞，使用OWASP ZAP扫描接口漏洞；
- **敏感信息脱敏**：日志中隐藏手机号（138****1234）、身份证（110**********1234）、银行卡号等信息。
