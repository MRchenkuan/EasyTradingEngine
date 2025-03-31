import fs from 'fs';
import path from 'path';

// 获取当前文件路径
const __dirname = path.dirname(new URL(import.meta.url).pathname);

const DATA_FILE = path.join(__dirname, '../records/local-variables.json');

export class LocalVariable {
  static _memoryCache = null;
  static _saveTimer = null;
  static _isDirty = false;

  constructor(pathStr) {
    // 确保存储目录存在
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        console.error('创建存储目录失败:', error.message);
      }
    }

    this._path = this._parsePath(pathStr);
    this._initCache();
    return this._createProxy();
  }

  _initCache() {
    if (LocalVariable._memoryCache === null) {
      LocalVariable._memoryCache = this._loadData();
      this._setupAutoSave();
    }
  }

  _setupAutoSave() {
    if (!LocalVariable._saveTimer) {
      LocalVariable._saveTimer = setInterval(() => {
        if (LocalVariable._isDirty) {
          this._forceSave();
          LocalVariable._isDirty = false;
        }
      }, 500);
    }
  }

  _parsePath(pathStr) {
    return pathStr.split('/').filter(p => p !== '');
  }

  _createProxy() {
    const handler = {
      get: (target, prop) => {
        // 允许访问类自身的方法和属性
        if (prop in target) {
          return target[prop];
        }
        const value = this._getValue(prop);
        // 如果值是对象，返回新的Proxy包裹的子节点
        if (value !== null && typeof value === 'object') {
          return new LocalVariable([...this._path, prop].join('/'));
        }
        return value;
      },
      set: (target, prop, value) => {
        if (prop in target) {
          target[prop] = value;
          return true;
        }
        this._setValue(prop, value);
        return true;
      },
      ownKeys: target => {
        const current = this._getCurrentData();
        if (typeof current === 'object' && current !== null) {
          return Reflect.ownKeys(current);
        }
        return [];
      },
      getOwnPropertyDescriptor: (target, prop) => {
        const current = this._getCurrentData();
        if (typeof current === 'object' && current !== null && current.hasOwnProperty(prop)) {
          return Reflect.getOwnPropertyDescriptor(current, prop);
        }
        return undefined; // 关键修复：不存在的属性返回undefined
      },
      deleteProperty: (target, prop) => {
        let current = LocalVariable._memoryCache;
        const path = [...this._path];
        // 定位到父节点
        for (let i = 0; i < path.length; i++) {
          const key = path[i];
          if (typeof current[key] !== 'object') {
            current[key] = {};
          }
          current = current[key];
        }
        if (current.hasOwnProperty(prop)) {
          delete current[prop];
          LocalVariable._isDirty = true;
          return true;
        }
        return false;
      },
    };
    return new Proxy(this, handler);
  }

  _getCurrentData() {
    let current = LocalVariable._memoryCache;
    for (const key of this._path) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return null;
      }
    }
    return current;
  }

  _setValue(prop, value) {
    let current = LocalVariable._memoryCache;
    const path = [...this._path, prop];

    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }

    current[path[path.length - 1]] = value;
    LocalVariable._isDirty = true;
  }

  _forceSave() {
    try {
      const content = JSON.stringify(LocalVariable._memoryCache, null, 2)
      fs.writeFileSync(DATA_FILE, content, 'utf8');
    } catch (error) {
      console.error('保存本地变量失败:', error.message);
    }
  }

  // 在程序退出时确保数据被保存
  static cleanup() {
    if (this._saveTimer) {
      clearInterval(this._saveTimer);
      this._saveTimer = null;
    }
    if (this._isDirty && this._memoryCache) {
      const instance = new LocalVariable('');
      instance._forceSave();
    }
  }

  _getValue(prop) {
    const current = this._getCurrentData();
    return current?.[prop];
  }

  _loadData() {
    try {
      const content = fs.readFileSync(DATA_FILE, 'utf8');
      // 增加空文件检查
      if (!content.trim()) {
        return {};
      }
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) {
        // 文件不存在或 JSON 解析错误时，返回空对象
        return {};
      }
      throw error;
    }
  }
}

// 添加进程退出时的清理
process.on('exit', () => LocalVariable.cleanup());
process.on('SIGINT', () => {
  LocalVariable.cleanup();
  process.exit();
});
