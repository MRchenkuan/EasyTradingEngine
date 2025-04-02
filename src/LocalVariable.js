import fs from 'fs';
import path from 'path';

// 获取当前文件路径
const __dirname = path.dirname(new URL(import.meta.url).pathname);

const DATA_FILE = path.join(__dirname, '../records/local-variables.json');

export class LocalVariable {
  static _memoryCache = null;
  static _saveTimer = null;
  static _isDirty = false;
  static _changes = new Map(); // 记录变更

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
      }, 1000);
    }
  }

  _parsePath(pathStr) {
    return pathStr.split('/').filter(p => p !== '');
  }

  _createProxy() {
    const handler = {
      get: (target, prop) => {
        // 处理内部属性，避免递归
        if (prop === '_path' || 
            prop === '_getCurrentData' || 
            prop === '_getValue' || 
            prop === '_isProxy' || 
            prop === 'then') { // 处理 Promise 接口
          return target[prop];
        }

        // 允许访问类的方法和属性
        if (prop in target) {
          return target[prop];
        }

        const value = this._getCurrentData();
        if (!value || typeof value !== 'object') {
          return undefined;
        }

        const propValue = value[prop];
        
        // 只为对象类型创建新的代理
        if (propValue !== null && typeof propValue === 'object' && !propValue._isProxy) {
          const newProxy = new LocalVariable([...this._path, prop].join('/'));
          newProxy._isProxy = true;
          return newProxy;
        }
        
        return propValue;
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
    const fullPath = path.join('/');

    // 记录变更
    LocalVariable._changes.set(fullPath, value);

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
      // 读取当前文件内容
      let fileContent = {};
      try {
        const content = fs.readFileSync(DATA_FILE, 'utf8');
        if (content.trim()) {
          fileContent = JSON.parse(content);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error('读取文件失败:', error);
        }
      }

      // 应用变更到文件内容
      for (const [path, value] of LocalVariable._changes) {
        let current = fileContent;
        const parts = path.split('/');

        // 创建或更新路径
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          if (!(part in current)) {
            current[part] = {};
          }
          current = current[part];
        }

        // 设置最终值
        current[parts[parts.length - 1]] = value;
      }

      // 更新内存缓存
      LocalVariable._memoryCache = fileContent;
      LocalVariable._changes.clear();

      // 保存到文件
      fs.writeFileSync(DATA_FILE, JSON.stringify(fileContent, null, 2), 'utf8');
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
