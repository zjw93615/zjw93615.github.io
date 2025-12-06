---
title: CSRF攻击
tags:
  - 安全
  - XSS
  - CSRF
categories:
  - 安全
date: 2025-12-06 21:18:21
---

# CSRF攻击详解：原理、流程与防御

## 什么是CSRF攻击？

CSRF（Cross-Site Request Forgery，跨站请求伪造）是一种常见的网络攻击方式，也被称为"one-click attack"或"session riding"。它通过诱骗已登录的用户在不知情的情况下，向其已登录的Web应用程序发送非本意的请求，从而执行恶意操作。

与XSS攻击不同：
- **XSS**：利用的是用户对指定网站的信任
- **CSRF**：利用的是网站对用户网页浏览器的信任

CSRF是互联网重大安全隐患之一，曾影响过纽约时报、YouTube、Gmail和百度HI等知名网站。

## CSRF攻击原理与具体流程

CSRF攻击的核心在于**利用了Web应用程序对用户浏览器中Cookie的信任机制**。服务器通常只验证请求中是否携带有效Cookie，而不验证请求是否由用户自愿发起。

### 完整攻击流程：

1. **用户正常登录**：用户C打开浏览器，访问受信任网站A（如银行网站），输入用户名和密码登录
2. **获取身份凭证**：网站A验证通过后，将Cookie（含身份信息）返回给浏览器，用户登录成功
3. **访问恶意网站**：用户未退出网站A，在同一浏览器中打开攻击者网站B
4. **加载恶意代码**：网站B返回包含恶意代码的页面（可能是一个自动提交的表单或隐藏图片）
5. **自动发起请求**：浏览器在用户不知情的情况下，携带网站A的Cookie向网站A发起请求
6. **服务器误判**：网站A验证Cookie有效，认为这是合法用户操作
7. **执行恶意操作**：服务器执行攻击者预设的操作（如转账、修改密码等）

### 典型攻击代码示例：

1. **隐藏图片请求**：
```html
<img src="https://bank.com/transfer?to=attacker&amount=1000" style="display:none;">
```

2. **自动提交表单**：
```html
<form id="csrf-form" action="https://bank.com/transfer" method="POST">
  <input type="hidden" name="to" value="attacker">
  <input type="hidden" name="amount" value="1000">
</form>
<script>
  // 页面加载时自动提交表单
  document.getElementById('csrf-form').submit();
</script>
```

3. **社交媒体攻击**：
```html
<a href="https://evil.com/funny-cat-video">
  <img src="https://evil.com/csrf-trigger" style="display:none">
  点击看搞笑猫咪视频！
</a>
```

## CSRF攻击防御措施

### 1. Anti-CSRF Token（同步令牌模式）- ⭐最佳实践⭐
- 服务器生成随机token，存入session
- 将token嵌入到表单或请求头中
- 服务器验证请求中的token是否有效
- 实现原理：
  - 用户访问表单 → 服务器生成Token → Token存入Session → Token嵌入表单
  - 用户提交表单 → 服务器验证Token → 验证成功执行操作，失败则拒绝请求

### 2. SameSite Cookie属性配置
```http
Set-Cookie: sessionid=abc123; SameSite=Strict
```
- **Strict**：完全禁止第三方网站使用Cookie发起请求
- **Lax**：允许安全的GET请求（如链接跳转），但阻止POST等非安全请求

### 3. 验证HTTP Referer字段
- 检查请求头中的Referer字段，确认请求来源
- 拒绝来源不明或非法的请求
- 实现示例：
```javascript
if (!req.headers.referer || !req.headers.referer.startsWith('https://yourdomain.com')) {
  return res.status(403).send('CSRF detected');
}
```

### 4. 敏感操作二次验证
- 对转账、密码修改等敏感操作增加额外验证
- 如：输入交易密码、短信验证码、安全令牌等
- 即使攻击者能够发起请求，也无法通过二次验证

### 5. 其他防御措施
- **使用JSON API**：只接受JSON格式数据，因为JavaScript发起的AJAX请求受同源策略限制
- **限制GET请求**：敏感操作只允许使用POST/PUT/DELETE等方法
- **添加验证码**：对关键操作添加图形验证码
- **自定义请求头**：在请求头中添加自定义属性并验证
- **框架内置防护**：使用Django、Spring Security等框架内置的CSRF防护

## 总结

CSRF攻击利用了Web应用对用户浏览器Cookie的信任机制，危害程度高，可能造成资金盗取、信息泄露等严重后果。最有效的防御措施是实现Anti-CSRF Token机制，配合SameSite Cookie属性配置和其他安全策略，可以有效抵御CSRF攻击。在开发Web应用时，对所有敏感操作都应考虑CSRF防护，特别是在处理用户账户、资金交易等关键功能时。