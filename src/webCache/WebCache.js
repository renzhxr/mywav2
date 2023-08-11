/*
 * MywaJS 2023
 * re-developed wwebjs
 * using with playwright & wajs
 * contact:
 * wa: 085157489446
 * ig: amirul.dev
 */

/**
 * Default implementation of a web version cache that does nothing.
 */
class WebCache {
    async resolve() { return null; }
    async persist() { }
}

class VersionResolveError extends Error { }

export default {
    WebCache,
    VersionResolveError
}