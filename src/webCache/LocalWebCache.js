/*
 * MywaJS 2023
 * re-developed wwebjs
 * using with playwright & wajs
 * contact:
 * wa: 085157489446
 * ig: amirul.dev
 */

import path from 'path'
import fs from 'fs'

import { WebCache, VersionResolveError } from './WebCache'

/**
 * LocalWebCache - Fetches a WhatsApp Web version from a local file store
 * @param {object} options - options
 * @param {string} options.path - Path to the directory where cached versions are saved, default is: "./.wwebjs_cache/" 
 * @param {boolean} options.strict - If true, will throw an error if the requested version can't be fetched. If false, will resolve to the latest version.
 */
class LocalWebCache extends WebCache {
    constructor(options = {}) {
        super();

        this.path = options.path || './.mywajs_cache/';
        this.strict = options.strict || false;
    }

    async resolve(version) {
        const filePath = path.join(this.path, `${version}.html`);
        
        try {
            return fs.readFileSync(filePath, 'utf-8');
        }
        catch (err) {
            if (this.strict) throw new VersionResolveError(`Couldn't load version ${version} from the cache`);
            return null;
        }
    }

    async persist(indexHtml) {
        // extract version from index (e.g. manifest-2.2206.9.json -> 2.2206.9)
        const version = indexHtml.match(/manifest-([\d\\.]+)\.json/)[1];
        if(!version) return;
   
        const filePath = path.join(this.path, `${version}.html`);
        fs.mkdirSync(this.path, { recursive: true });
        fs.writeFileSync(filePath, indexHtml);
    }
}

export default LocalWebCache;