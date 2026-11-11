'use strict';
const STORAGE_KEY = 'plane-duel-online-room';

class RoomClient {
  constructor({ serverUrl = '', cloudEnv = '', cloudFunction = 'planeDuel', onState, onError, platform = wx }) {
    this.useCloud = !serverUrl;
    this.cloudEnv = cloudEnv;
    this.cloudFunction = cloudFunction;
    this.base = this.useCloud ? `cloud:${cloudEnv}:${cloudFunction}` : serverUrl.replace(/\/+$/, '');
    this.platform = platform;
    this.onState = onState;
    this.onError = onError;
    this.session = null;
    this.state = null;
    this.generation = 0;
    this.pollGeneration = 0;
    this.polling = false;
  }

  request(route, body, session = this.session) {
    if (this.useCloud) return this.cloudRequest(route, body, session);
    return new Promise((resolve, reject) => {
      this.platform.request({
        url: this.base + route, method: body === undefined ? 'GET' : 'POST',
        timeout: 6000, data: body,
        header: { 'content-type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
        success: response => {
          if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data);
          else reject(new Error(response.data && response.data.error || '请求失败'));
        },
        fail: () => reject(new Error('无法连接服务器，请检查网络或稍后重试'))
      });
    });
  }

  cloudRequest(route, body, session) {
    const match = route.match(/^\/api\/rooms(?:\/(\d{6})(?:\/(join|fire|restart))?)?$/);
    if (!match) return Promise.reject(new Error('无效的房间操作'));
    const action = !match[1] ? 'create' : match[2] || 'state';
    return new Promise((resolve, reject) => {
      this.platform.cloud.callFunction({
        name: this.cloudFunction, config: { env: this.cloudEnv },
        data: { ...(body || {}), action, room: match[1], token: session && session.token },
        success: response => {
          const result = response.result;
          if (result && result.ok) resolve(result.state);
          else reject(new Error(result && result.error || '联机服务暂时不可用'));
        },
        fail: () => reject(new Error('无法连接联机服务，请检查网络或稍后重试'))
      });
    });
  }

  accept(state) {
    if (!this.state || state.revision >= this.state.revision) {
      this.state = state;
      this.onState(state);
    }
  }

  async connect(code) {
    if (this.useCloud) {
      if (!this.cloudEnv) throw new Error('联机服务尚未开通，请先配置微信云开发环境');
      if (!this.platform.cloud) throw new Error('当前微信版本不支持云开发，请升级微信');
    } else if (!/^https?:\/\//.test(this.base)) throw new Error('联机服务尚未开通');
    if (code !== undefined && !/^\d{6}$/.test(code)) throw new Error('请输入 6 位房间号');
    const generation = ++this.generation;
    const state = await this.request(code === undefined ? '/api/rooms' : `/api/rooms/${code}/join`, {}, null);
    if (generation !== this.generation) return;
    this.session = { base: this.base, room: state.room, player: state.player, token: state.token };
    this.state = null;
    this.platform.setStorageSync(STORAGE_KEY, this.session);
    this.accept(state);
    this.start();
  }

  restore() {
    const session = this.platform.getStorageSync(STORAGE_KEY);
    if (!session || session.base !== this.base || !/^\d{6}$/.test(session.room) || typeof session.token !== 'string' || ![0, 1].includes(session.player)) return false;
    this.session = session;
    this.start();
    return true;
  }

  async action(action, body = {}) {
    if (!this.session || !this.state) throw new Error('请等待房间连接完成');
    const generation = this.generation, session = this.session;
    const state = await this.request(`/api/rooms/${session.room}/${action}`, body, session);
    if (generation === this.generation) this.accept(state);
  }

  fire(row, col) {
    return this.action('fire', { row, col, revision: this.state && this.state.revision });
  }

  start() {
    if (!this.session || this.polling) return;
    this.polling = true;
    const pollGeneration = ++this.pollGeneration;
    const poll = async () => {
      const generation = this.generation, session = this.session;
      try {
        const state = await this.request(`/api/rooms/${session.room}`, undefined, session);
        if (this.polling && pollGeneration === this.pollGeneration && generation === this.generation) this.accept(state);
      } catch (error) {
        if (this.polling && pollGeneration === this.pollGeneration && generation === this.generation) this.onError(error);
      } finally {
        if (this.polling && pollGeneration === this.pollGeneration && generation === this.generation) this.timer = setTimeout(poll, 800);
      }
    };
    poll();
  }

  stop() {
    this.polling = false;
    this.pollGeneration++;
    clearTimeout(this.timer);
  }

  leave() {
    this.stop();
    this.generation++;
    this.session = null;
    this.state = null;
    this.platform.removeStorageSync(STORAGE_KEY);
  }
}
module.exports = RoomClient;
