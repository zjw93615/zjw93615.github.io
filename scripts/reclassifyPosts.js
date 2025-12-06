const fs = require('fs');
const path = require('path');

function readDirSafe(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function firstHeading(content) {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^#\s+(.*)$/);
    if (m) return m[1].trim();
  }
  return null;
}

function hasFrontMatter(content) {
  return content.trimStart().startsWith('---');
}

function detectByName(name) {
  const n = name.toLowerCase();
  const has = (k) => n.includes(k);
  if (has('typescript')) return 'TypeScript';
  if (has('redis')) return 'Redis';
  if (has('webpack') || has('tree shaking')) return 'Webpack';
  if (has('xss') || has('csrf') || has('安全')) return '安全';
  if (has('react') && has('vue')) return 'React_Vue';
  if (has('react')) return 'React';
  if (has('vue')) return 'Vue';
  if (has('koa')) return 'Koa';
  if (has('缓存') || has('预加载') || has('首页渲染优化') || has('重排')) return '性能优化';
  if (has('面试')) return '面试';
  return null;
}

function detectByContent(name, content) {
  const s = (name + '\n' + content).toLowerCase();
  const has = (k) => s.includes(k);
  if (has('typescript')) return 'TypeScript';
  if (has('redis')) return 'Redis';
  if (has('webpack') || has('tree shaking')) return 'Webpack';
  if (has('xss') || has('csrf') || has('安全')) return '安全';
  if (has('react') && has('vue')) return 'React_Vue';
  if (has('react')) return 'React';
  if (has('vue')) return 'Vue';
  if (has('koa')) return 'Koa';
  if (has('缓存') || has('preload') || has('首页渲染优化') || has('重排') || has('性能')) return '性能优化';
  if (has('面试')) return '面试';
  return 'Javascript';
}

function detectCategory(name, content) {
  return detectByName(name) || detectByContent(name, content);
}

function detectTags(name, content, category) {
  const s = (name + '\n' + content).toLowerCase();
  const tags = new Set();
  tags.add(category);
  if (s.includes('koa')) tags.add('Koa');
  if (s.includes('react')) tags.add('React');
  if (s.includes('vue')) tags.add('Vue');
  if (s.includes('redis')) tags.add('Redis');
  if (s.includes('webpack')) tags.add('Webpack');
  if (s.includes('tree shaking')) tags.add('TreeShaking');
  if (s.includes('typescript')) tags.add('TypeScript');
  if (s.includes('xss')) tags.add('XSS');
  if (s.includes('csrf')) tags.add('CSRF');
  if (s.includes('性能') || s.includes('优化')) tags.add('性能优化');
  if (s.includes('缓存')) tags.add('缓存');
  if (s.includes('面试')) tags.add('面试');
  return Array.from(tags);
}

function updateFrontMatter(content, title, category, tags) {
  if (!hasFrontMatter(content)) return content;
  const idxStart = content.indexOf('---');
  const idxEnd = content.indexOf('\n---', idxStart + 3);
  if (idxStart !== 0 || idxEnd === -1) return content;
  const fmBlock = content.slice(0, idxEnd + 4);
  const body = content.slice(idxEnd + 4);
  const lines = fmBlock.split(/\r?\n/);
  const out = [];
  let inTags = false;
  let inCategories = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0) {
      out.push('---');
      continue;
    }
    if (line.startsWith('title:')) {
      out.push(`title: ${title}`);
      continue;
    }
    if (line.startsWith('tags:')) {
      out.push('tags:');
      inTags = true;
      continue;
    }
    if (inTags) {
      if (line.startsWith('categories:')) {
        inTags = false;
      } else if (line.trim().startsWith('-')) {
        continue;
      }
    }
    if (line.startsWith('categories:')) {
      out.push('categories:');
      out.push(`  - ${category}`);
      inCategories = true;
      continue;
    }
    if (inCategories) {
      if (line.trim().startsWith('-')) {
        continue;
      }
    }
    if (line === '---') {
      inTags = false;
      inCategories = false;
      const tagLines = tags.map((t) => `  - ${t}`).join('\n');
      const injected = ['tags:', tagLines].join('\n');
      out.push(injected);
      out.push('---');
      continue;
    }
    out.push(line);
  }
  return out.join('\n') + body;
}

function reclassify() {
  const root = process.cwd();
  const postsRoot = path.join(root, 'source', '_posts');
  const categories = readDirSafe(postsRoot);
  for (const cat of categories) {
    const catDir = path.join(postsRoot, cat);
    const files = readDirSafe(catDir).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const srcPath = path.join(catDir, file);
      const raw = readFile(srcPath);
      const newCategory = detectCategory(file, raw);
      if (!newCategory || newCategory === cat) continue;
      const title = firstHeading(raw) || path.basename(file, '.md');
      const tags = detectTags(file, raw, newCategory);
      const updated = updateFrontMatter(raw, title, newCategory, tags);
      const destDir = path.join(postsRoot, newCategory);
      ensureDir(destDir);
      const destPath = path.join(destDir, file);
      fs.writeFileSync(destPath, updated, 'utf8');
      fs.unlinkSync(srcPath);
    }
  }
}

reclassify();

