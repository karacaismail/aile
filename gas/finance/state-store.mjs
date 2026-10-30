const PREFIX = 'FINANCE_AUTO_V1_';
const ACTIVE = PREFIX + 'ACTIVE';

export const sha256 = (utilities, text) => utilities.computeDigest(
  utilities.DigestAlgorithm.SHA_256, text, utilities.Charset.UTF_8,
).map(n => ((n + 256) % 256).toString(16).padStart(2, '0')).join('');

/** Stores complete immutable banks before moving the durable active pointer. */
export class DurableStateStore {
  constructor({properties, utilities}) {
    this.properties = properties;
    this.utilities = utilities;
  }

  load({optional = false} = {}) {
    // One service read gives a coherent snapshot of both pointer and chunks.
    const snapshot = this.properties.getProperties();
    const id = snapshot[ACTIVE];
    if (!id) {
      if (optional) return null;
      throw Error('Finans otomasyonu kurulmamış.');
    }
    const count = Number(snapshot[PREFIX + id + '_COUNT']);
    if (!Number.isInteger(count) || count < 1 || count > 50) throw Error('Otomasyon durum kaydı geçersiz.');
    let data = '';
    for (let i = 0; i < count; i++) {
      const part = snapshot[PREFIX + id + '_' + i];
      if (part == null) throw Error('Otomasyon durum parçası eksik.');
      data += part;
    }
    const u = this.utilities;
    if (sha256(u, data) !== id) throw Error('Otomasyon durum bütünlüğü geçersiz.');
    return JSON.parse(u.ungzip(u.newBlob(u.base64Decode(data), 'application/gzip')).getDataAsString('UTF-8'));
  }

  save(state) {
    const p = this.properties, u = this.utilities;
    const old = p.getProperty(ACTIVE);
    const data = u.base64Encode(u.gzip(u.newBlob(JSON.stringify(state), 'application/json')).getBytes());
    const id = sha256(u, data);
    if (id === old) return;
    if (data.length > 180000) throw Error('Otomasyon durum kaydı kapasite sınırını aşıyor.');
    // A hard timeout may leave an unreferenced bank. Reclaim it before allocating.
    this.removeOtherBanks(old);
    const next = {};
    for (let i = 0; i < data.length; i += 7500) next[PREFIX + id + '_' + i / 7500] = data.slice(i, i + 7500);
    next[PREFIX + id + '_COUNT'] = String(Math.ceil(data.length / 7500));
    p.setProperties(next, false);
    p.setProperty(ACTIVE, id);
    this.removeOtherBanks(id);
  }

  removeOtherBanks(keep) {
    for (const key of this.properties.getKeys()) {
      if (key.startsWith(PREFIX) && key !== ACTIVE && (!keep || !key.startsWith(PREFIX + keep + '_'))) {
        this.properties.deleteProperty(key);
      }
    }
  }
}
