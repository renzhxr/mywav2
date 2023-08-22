/*
 * MywaJS 2023
 * re-developed wwebjs
 * using with playwright & wajs
 * contact:
 * wa: 085157489446
 * ig: amirul.dev
 */

'use strict';

/**
 * Base class which all authentication strategies extend
 */
class BaseAuthStrategy {
    constructor() { }
    setup(client) {
        this.client = client;
    }
    async beforeBrowserInitialized() { }
    async afterBrowserInitialized() { }
    async onAuthenticationNeeded() {
        return {
            failed: false,
            restart: false,
            failureEventPayload: undefined
        };
    }
    async getAuthEventPayload() { }
    async afterAuthReady() { }
    async disconnect() { }
    async destroy() { }
    async logout() { }
}

export default BaseAuthStrategy;