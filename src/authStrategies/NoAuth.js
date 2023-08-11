/*
 * MywaJS 2023
 * re-developed wwebjs
 * using with playwright & wajs
 * contact:
 * wa: 085157489446
 * ig: amirul.dev
 */

'use strict';

import BaseAuthStrategy from './BaseAuthStrategy.js';
/**
 * No session restoring functionality
 * Will need to authenticate via QR code every time
*/
class NoAuth extends BaseAuthStrategy { }

export default NoAuth;