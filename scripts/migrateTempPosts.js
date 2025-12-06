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

function detectCategory(name, content) {
  const s = (name + '\n' + content).toLowerCase();
  const has = (k) => s.includes(k);
  if (has('koa')) return 'Koa';
  if (has('react') && has('vue')) return 'React_Vue';
  if (has('react')) return 'React';
  if (has('vue')) return 'Vue';
  if (has('redis')) return 'Redis';
  if (has('webpack') || has('tree shaking')) return 'Webpack';
  if (has('typescript')) return 'TypeScript';
  if (has('xss') || has('csrf') || has('安全')) return '安全';
  if (has('缓存') || has('preload') || has('首页渲染优化') || has('重排') || has('性能')) return '性能优化';
  if (has('面试')) return '面试';
  return 'Javascript';
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

function toYAMLList(items) {
  return items.map((t) => `  - ${t}`).join('\n');
}

function buildFrontMatter(title, category, tags) {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  return `---\ntitle: ${title}\ntags:\n${toYAMLList(tags)}\ncategories:\n  - ${category}\ndate: ${dateStr}\n---\n\n`;
}

function normalizeFileName(name) {
  return name.replace(/\s+/g, ' ').trim();
}

function migrate() {
  const root = process.cwd();
  const tempDir = path.join(root, 'temp');
  const postsRoot = path.join(root, 'source', '_posts');
  const files = readDirSafe(tempDir).filter((f) => f.endsWith('.md'));
  for (const file of files) {
    const srcPath = path.join(tempDir, file);
    const raw = fs.readFileSync(srcPath, 'utf8');
    const category = detectCategory(file, raw);
    const title = firstHeading(raw) || path.basename(file, '.md');
    const tags = detectTags(file, raw, category);
    const fm = buildFrontMatter(title, category, tags);
    const content = hasFrontMatter(raw) ? raw : fm + raw;
    const destDir = path.join(postsRoot, category);
    ensureDir(destDir);
    const destName = normalizeFileName(file);
    const destPath = path.join(destDir, destName);
    fs.writeFileSync(destPath, content, 'utf8');
    fs.unlinkSync(srcPath);
  }
}

migrate();

