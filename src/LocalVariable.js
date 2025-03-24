import fs from 'fs'
import path from 'path'

// 获取当前文件路径
const __dirname = path.dirname(new URL(import.meta.url).pathname);

const DATA_FILE = path.join(__dirname, '../records/local-variables.json');

export class LocalVariable {
  constructor(pathStr) {
    this._path = this._parsePath(pathStr);
    return this._createProxy();
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
      ownKeys: (target) => {
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
        const data = this._loadData();
        let current = data;
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
          this._saveData(data);
          return true;
        }
        return false;
      }
    };
    return new Proxy(this, handler);
  }

  _getCurrentData() {
    const data = this._loadData();
    let current = data;
    for (const key of this._path) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return null;
      }
    }
    return current;
  }
  
  _getValue(prop) {
    const current = this._getCurrentData();
    return current?.[prop];
  }

  _setValue(prop, value) {
    const data = this._loadData();
    let current = data;
    const path = [...this._path, prop];
    // 确保路径存在
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    current[path[path.length - 1]] = value;
    this._saveData(data);
  }

  _loadData() {
    try {
      const content = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(content) || {};
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  /**
   * 需要考虑多进程文件锁
   * @param {*} data 
   */
  _saveData(data) {
    // 当前实现在多进程环境下可能会有竞态条件
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  }
}