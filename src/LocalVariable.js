import fs from 'fs'
import path from 'path'

// 获取当前文件路径
const __dirname = path.dirname(new URL(import.meta.url).pathname);

const DATA_FILE = path.join(__dirname, '../records/local-variables.json');

export class LocalVariable {
  constructor(pathStr) {
    this._path = this._parsePath(pathStr);
    return new Proxy(this, {
      get: (target, prop) => {
        if (Object.prototype.hasOwnProperty.call(target, prop)) {
          return target[prop];
        }
        return this._getValue(prop);
      },
      set: (target, prop, value) => {
        if (Object.prototype.hasOwnProperty.call(target, prop)) {
          target[prop] = value;
          return true;
        }
        this._setValue(prop, value);
        return true;
      },
    });
  }

  _parsePath(pathStr) {
    return pathStr.split('/').filter(p => p !== '');
  }

  _getValue(prop) {
    const data = this._loadData();
    const keys = [...this._path, prop];
    let current = data;
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return undefined;
      }
    }
    return current;
  }

  _setValue(prop, value) {
    const data = this._loadData();
    const keys = [...this._path, prop];
    let current = data;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    current[keys[keys.length - 1]] = value;
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

  _saveData(data) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  }
}