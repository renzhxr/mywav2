"use strict";

const EventEmitter = require("events");
const chromium = require("puppeteer-core");
const moduleRaid = require("@pedroslopez/moduleraid/moduleraid");
const fs = require("fs");
const Util = require("./util/Util");
const xutil = require('util')
const InterfaceController = require("./util/InterfaceController");
const {
WhatsWebURL,
DefaultOptions,
Events,
WAState,
} = require("./util/Constants");
const { ExposeStore, LoadUtils } = require("./util/Injected");
const ChatFactory = require("./factories/ChatFactory");
const ContactFactory = require("./factories/ContactFactory");
const WebCacheFactory = require("./webCache/WebCacheFactory");
const {
ClientInfo,
Message,
MessageMedia,
Contact,
Location,
GroupNotification,
Label,
Call,
Buttons,
List,
Reaction,
Chat,
} = require("./structures");
const LegacySessionAuth = require("./authStrategies/LegacySessionAuth");
const NoAuth = require("./authStrategies/NoAuth");
const LinkingMethod = require("./authStrategies/LinkingMethod");

class Client extends EventEmitter {
constructor(options = {}) {
super();

this.options = Util.mergeDefault(DefaultOptions, options);

if (!this.options.linkingMethod) {
this.options.linkingMethod = new LinkingMethod({
qr: {
maxRetries: this.options.qrMaxRetries,
},
});
}

if (!this.options.authStrategy) {
if (Object.prototype.hasOwnProperty.call(this.options, "session")) {
process.emitWarning(
"options.session is deprecated and will be removed in a future release due to incompatibility with multi-device. " +
"Use the LocalAuth authStrategy, don't pass in a session as an option, or suppress this warning by using the LegacySessionAuth strategy explicitly (see https://wwebjs.dev/guide/authentication.html#legacysessionauth-strategy).",
"DeprecationWarning"
);

this.authStrategy = new LegacySessionAuth({
session: this.options.session,
restartOnAuthFail: this.options.restartOnAuthFail,
});
} else {
this.authStrategy = new NoAuth();
}
} else {
this.authStrategy = this.options.authStrategy;
}

this.authStrategy.setup(this);

this.pupBrowser = null;
this.mPage = null;

Util.setFfmpegPath(this.options.ffmpegPath);
}

/**
 * Sets up events and requirements, kicks off authentication request
 */
async initialize() {
let [browser, page] = [null, null];

await this.authStrategy.beforeBrowserInitialized();

const chromiumOpts = this.options.chromium; 
 if (chromiumOpts && chromiumOpts.browserWSEndpoint) { 
 browser = await chromium.connect(chromiumOpts); 
 page = await browser.newPage(); 
 } else { 
 const browserArgs = [...(chromiumOpts.args || [])]; 
 if(!browserArgs.find(arg => arg.includes('--user-agent'))) { 
 browserArgs.push(`--user-agent=${this.options.userAgent}`); 
 } 

 browser = await chromium.launch({...chromiumOpts, args: browserArgs}); 
 page = (await browser.pages())[0]; 
 } 

 if (this.options.proxyAuthentication !== undefined) { 
 await page.authenticate(this.options.proxyAuthentication); 
 } 

 await page.setUserAgent(this.options.userAgent); 
 if (this.options.bypassCSP) await page.setBypassCSP(true); 

 this.pupBrowser = browser; 
 this.mPage = page; 

 await this.authStrategy.afterBrowserInitialized();
// await this.initWebVersionCache();
await page.setViewport({ width: 501, height: 700 });

await page.goto(WhatsWebURL, {
waitUntil: "load",
timeout: 0,
referer: "https://whatsapp.com/",
});

await page.addScriptTag({
path: require.resolve("@wppconnect/wa-js"),
});

// Wait WA-JS load
await page.waitForFunction(() => window.WPP?.isReady);

await page
.evaluate(
(markOnlineAvailable, isBeta) => {
WPP.chat.defaultSendMessageOptions.createChat = true;
if (markOnlineAvailable) WPP.conn.setKeepAlive(markOnlineAvailable);
WPP.conn.joinWebBeta(true);
},
this.options.markOnlineAvailable,
this.options.isBeta
)
.catch(() => false);

await page.evaluate(() => {
WPP.conn.setLimit("maxMediaSize", 16777216);
WPP.conn.setLimit("maxFileSize", 104857600);
WPP.conn.setLimit("maxShare", 100);
WPP.conn.setLimit("statusVideoMaxDuration", 120);
WPP.conn.setLimit("unlimitedPin", true);
});

// new
const getElementByXpath = (path) => {
return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
};

let lastPercent = null,
lastPercentMessage = null;
let loads = false
// Menambahkan fungsi `loadingScreen` ke halaman
await page.exposeFunction('loadingScreen', (percent, message) => {
console.log('Process: ' + percent + '%');
console.log('Message: ' + message);
});

const progressClass = 'progress.ZJWuG';

await page.exposeFunction('getProgressValue', async (progressClass) => {
const progressBar = await page.$(progressClass);
if (progressBar) {
return await progressBar.getAttribute('value');
}
return null;
});

await page.exposeFunction('getProgressMessage', async () => {
const progressMessage = await page.$('div._3HbCE')
if (progressMessage) {
return progressMessage.textContent;
}
return null;
});

await page.evaluate(() => {
const observer = new MutationObserver(async () => {
const percent = await window.getProgressValue('progress.ZJWuG');
const message = await window.getProgressMessage();
if (percent !== null && message !== null) {
window.loadingScreen(percent, message);
}
});

observer.observe(document, {
attributes: true,
childList: true,
characterData: true,
subtree: true,
});
});

console.log(
`You Used Selector: ${this.options.selector ? this.options.selector : "default"
}`
);


const INTRO_IMG_SELECTOR =
this.options.selector == 1
? "div[role='textbox']"
: this.options.selector == 2
? '[data-icon="chat"],[data-icon="intro-md-beta-logo-dark"],[data-icon="intro-md-beta-logo-light"]'
: this.options.selector == 3
? "[data-icon='chat']"
: this.options.selector == 4
? `['[data-icon*=community]', '[data-icon*=status]', '[data-icon*=community]', '[data-icon*=chat]', '[data-icon*=back]', '[data-icon*=search]', '[data-icon*=filter]', '[data-icon*=lock-small]', '[data-icon*=chat]']`
: this.options.selector == 5 ? '[data-testid="intro-md-beta-logo-dark"], [data-testid="intro-md-beta-logo-light"], [data-asset-intro-image-light="true"], [data-asset-intro-image-dark="true"],' +
'[data-icon="intro-md-beta-logo-dark"], [data-icon="intro-md-beta-logo-light"]' : this.options.selector == 6 ? '#side > div._3gYev > div > div._1EUay > div._2vDPL' : "[data-icon='search']";


const INTRO_QRCODE_SELECTOR = "div[data-ref] canvas";

// Checks which selector appears first
const needAuthentication = await Promise.race([
new Promise((resolve) => {
page
.waitForSelector(INTRO_IMG_SELECTOR, {
timeout: this.options.authTimeoutMs
})
.then(() => resolve(false))
.catch((err) => resolve(err));
}),
new Promise((resolve) => {
page
.waitForSelector(INTRO_QRCODE_SELECTOR, {
timeout: this.options.authTimeoutMs,
})
.then(() => resolve(true))
.catch((err) => resolve(err));
}),
]);

// Checks if an error occurred on the first found selector. The second will be discarded and ignored by .race;
if (needAuthentication instanceof Error) throw needAuthentication;

// Scan-qrcode selector was found. Needs authentication
if (needAuthentication) {
const { failed, failureEventPayload, restart } =
await this.authStrategy.onAuthenticationNeeded();
if (failed) {
/**
 * Emitted when there has been an error while trying to restore an existing session
 * @event Client#auth_failure
 * @param {string} message
 */
this.emit(Events.AUTHENTICATION_FAILURE, failureEventPayload);
await this.destroy();
if (restart) {
// session restore failed so try again but without session to force new authentication
return this.initialize();
}
return;
}

const loginQR = async () => {
const QR_CONTAINER = "div[data-ref]";
const QR_RETRY_BUTTON = "div[data-ref] > span > button";
let qrRetries = 0;
await page.exposeFunction("qrChanged", async (qr) => {
/**
 * Emitted when a QR code is received
 * @event Client#qr
 * @param {string} qr QR Code
 */
this.emit(Events.QR_RECEIVED, qr);
if (this.options.linkingMethod.qr.maxRetries > 0) {
qrRetries++;
if (qrRetries > this.options.linkingMethod.qr.maxRetries) {
this.emit(Events.DISCONNECTED, "Max qrcode retries reached");
await this.destroy();
}
}
});

await page.evaluate(
function (selectors) {
const qr_container = document.querySelector(selectors.QR_CONTAINER);
window.qrChanged(qr_container.dataset.ref);

const obs = new MutationObserver((muts) => {
muts.forEach((mut) => {
// Listens to qr token change
if (
mut.type === "attributes" &&
mut.attributeName === "data-ref"
) {
window.qrChanged(mut.target.dataset.ref);
}
// Listens to retry button, when found, click it
else if (mut.type === "childList") {
const retry_button = document.querySelector(
selectors.QR_RETRY_BUTTON
);
if (retry_button) retry_button.click();
}
});
});
obs.observe(qr_container.parentElement, {
subtree: true,
childList: true,
attributes: true,
attributeFilter: ["data-ref"],
});
},
{
QR_CONTAINER,
QR_RETRY_BUTTON,
}
);
};

const handleLinkWithPhoneNumber = async () => {
const LINK_WITH_PHONE_BUTTON = 'div._3rDmx div._2rQUO span._3iLTh';
const PHONE_NUMBER_INPUT = 'input.selectable-text';
const NEXT_BUTTON = 'div._1M6AF._3QJHf';
const CODE_CONTAINER = '[aria-details="link-device-phone-number-code-screen-instructions"]';
const GENERATE_NEW_CODE_BUTTON = '//*[@id="app"]/div/div/div[3]/div[1]/div/div/div[1]/div[2]/a';
const LINK_WITH_PHONE_VIEW = 'div._1x9Rv._3qC8O';

await page.exposeFunction("codeChanged", async (code) => {
/**
 * Emitted when a QR code is received
 * @event Client#code
 * @param {string} code Code
 */
this.emit(Events.CODE_RECEIVED, code);
});
const clickOnLinkWithPhoneButton = async () => {
await page.waitForSelector(LINK_WITH_PHONE_BUTTON, {
timeout: 0,
});
await page.click(LINK_WITH_PHONE_BUTTON, { visibility: true });
};

const typePhoneNumber = async () => {
await page.waitForSelector(PHONE_NUMBER_INPUT);
const inputValue = await page.$eval(
PHONE_NUMBER_INPUT,
(el) => el.value
);
await page.click(PHONE_NUMBER_INPUT, { visibility: true });
for (let i = 0; i < inputValue.length; i++) {
await page.keyboard.press("Backspace");
}
await page.type(
PHONE_NUMBER_INPUT,
this.options.linkingMethod.phone.number
);
};

await clickOnLinkWithPhoneButton();
await typePhoneNumber();
await page.click(NEXT_BUTTON);

await page.evaluate(
async function (selectors) {
function waitForElementToExist(selector, timeout = 60000) {
return new Promise(async (resolve, reject) => {
if (document.querySelector(selector)) {
return resolve(document.querySelector(selector));
}
const observer = new MutationObserver(() => {
if (document.querySelector(selector)) {
resolve(document.querySelector(selector));
observer.disconnect();
}
});

observer.observe(document.body, {
subtree: true,
childList: true,
});

if (timeout > 0) {
setTimeout(() => {
reject(
new Error(
`waitForElementToExist: ${selector} not found in time`
)
);
}, timeout);
}
});
}

await waitForElementToExist(selectors.CODE_CONTAINER);

const getCode = () => {
const codeContainer = document.querySelector(
selectors.CODE_CONTAINER
);
const code = Array.from(codeContainer.children)[0];

const cells = Array.from(code.children);
return cells.map((cell) => cell.textContent).join("");
};
let code = getCode();
window.codeChanged(code);

const entirePageObserver = new MutationObserver(() => {
const generateNewCodeButton = document.querySelector(
selectors.GENERATE_NEW_CODE_BUTTON
);
if (generateNewCodeButton) {
generateNewCodeButton.click();
return;
}
});
entirePageObserver.observe(document, {
subtree: true,
childList: true,
});

const linkWithPhoneView = document.querySelector(
selectors.LINK_WITH_PHONE_VIEW
);
const linkWithPhoneViewObserver = new MutationObserver(() => {
const newCode = getCode();
if (newCode !== code) {
window.codeChanged(newCode);
code = newCode;
}
});
linkWithPhoneViewObserver.observe(linkWithPhoneView, {
subtree: true,
childList: true,
});
},
{
CODE_CONTAINER,
GENERATE_NEW_CODE_BUTTON,
LINK_WITH_PHONE_VIEW,
}
);
};

const { linkingMethod } = this.options;

if (linkingMethod.isQR()) {
console.log("You login with QR");
await loginQR();
} else {
await handleLinkWithPhoneNumber();
}

// Wait for code scan 
try {
await page.waitForSelector(INTRO_IMG_SELECTOR, { timeout: 0 });
} catch (error) {
if (
error.name === 'ProtocolError' &&
error.message &&
error.message.match(/Target closed/)
) {
// something has called .destroy() while waiting 
return;
}

throw error;
}

}

await page.evaluate(() => {
/** 
 * Helper function that compares between two WWeb versions. Its purpose is to help the developer to choose the correct code implementation depending on the comparison value and the WWeb version. 
 * @param {string} lOperand The left operand for the WWeb version string to compare with 
 * @param {string} operator The comparison operator 
 * @param {string} rOperand The right operand for the WWeb version string to compare with 
 * @returns {boolean} Boolean value that indicates the result of the comparison 
 */
window.compareWwebVersions = (lOperand, operator, rOperand) => {
if (!['>', '>=', '<', '<=', '='].includes(operator)) {
throw new class _ extends Error {
constructor(m) { super(m); this.name = 'CompareWwebVersionsError'; }
}('Invalid comparison operator is provided');

}
if (typeof lOperand !== 'string' || typeof rOperand !== 'string') {
throw new class _ extends Error {
constructor(m) { super(m); this.name = 'CompareWwebVersionsError'; }
}('A non-string WWeb version type is provided');
}

lOperand = lOperand.replace(/-beta$/, '');
rOperand = rOperand.replace(/-beta$/, '');

while (lOperand.length !== rOperand.length) {
lOperand.length > rOperand.length
? rOperand = rOperand.concat('0')
: lOperand = lOperand.concat('0');
}

lOperand = Number(lOperand.replace(/\./g, ''));
rOperand = Number(rOperand.replace(/\./g, ''));

return (
operator === '>' ? lOperand > rOperand :
operator === '>=' ? lOperand >= rOperand :
operator === '<' ? lOperand < rOperand :
operator === '<=' ? lOperand <= rOperand :
operator === '=' ? lOperand === rOperand :
false
);
};
});

await page.evaluate(ExposeStore, moduleRaid.toString());
const authEventPayload = await this.authStrategy.getAuthEventPayload();

/** 
 * Emitted when authentication is successful 
 * @event Client#authenticated 
 */
this.emit(Events.AUTHENTICATED, authEventPayload);

// Check window.Store Injection 
await page.waitForFunction('window.Store != undefined');

await page.evaluate(async () => {
// safely unregister service workers 
const registrations = await navigator.serviceWorker.getRegistrations();
for (let registration of registrations) {
registration.unregister();
}
});

//Load util functions (serializers, helper functions) 
await page.evaluate(LoadUtils);

// Expose client info 
/** 
 * Current connection information 
 * @type {ClientInfo} 
 */
this.info = new ClientInfo(this, await page.evaluate(() => {
return { ...window.Store.Conn.serialize(), wid: window.Store.User.getMeUser() };
}));

// Add InterfaceController 
this.interface = new InterfaceController(this);

// Register events 
await page.exposeFunction('onAddMessageEvent', msg => {
if (msg.type === 'gp2') {
const notification = new GroupNotification(this, msg);
if (['add', 'invite', 'linked_group_join'].includes(msg.subtype)) {
/** 
 * Emitted when a user joins the chat via invite link or is added by an admin. 
 * @event Client#group_join 
 * @param {GroupNotification} notification GroupNotification with more information about the action 
 */
this.emit(Events.GROUP_JOIN, notification);
} else if (msg.subtype === 'remove' || msg.subtype === 'leave') {
/** 
 * Emitted when a user leaves the chat or is removed by an admin. 
 * @event Client#group_leave 
 * @param {GroupNotification} notification GroupNotification with more information about the action 
 */
this.emit(Events.GROUP_LEAVE, notification);
} else if (msg.subtype === 'promote' || msg.subtype === 'demote') {
/** 
 * Emitted when a current user is promoted to an admin or demoted to a regular user. 
 * @event Client#group_admin_changed 
 * @param {GroupNotification} notification GroupNotification with more information about the action 
 */
this.emit(Events.GROUP_ADMIN_CHANGED, notification);
} else {
/** 
 * Emitted when group settings are updated, such as subject, description or picture. 
 * @event Client#group_update 
 * @param {GroupNotification} notification GroupNotification with more information about the action 
 */
this.emit(Events.GROUP_UPDATE, notification);
}
return;
}

const message = new Message(this, msg);

/** 
 * Emitted when a new message is created, which may include the current user's own messages. 
 * @event Client#message_create 
 * @param {Message} message The message that was created 
 */
this.emit(Events.MESSAGE_CREATE, message);

if (msg.id.fromMe) return;

/** 
 * Emitted when a new message is received. 
 * @event Client#message 
 * @param {Message} message The message that was received 
 */
this.emit(Events.MESSAGE_RECEIVED, message);
});

let last_message;

await page.exposeFunction('onChangeMessageTypeEvent', (msg) => {

if (msg.type === 'revoked') {
const message = new Message(this, msg);
let revoked_msg;
if (last_message && msg.id.id === last_message.id.id) {
revoked_msg = new Message(this, last_message);
}

/** 
 * Emitted when a message is deleted for everyone in the chat. 
 * @event Client#message_revoke_everyone 
 * @param {Message} message The message that was revoked, in its current state. It will not contain the original message's data. 
 * @param {?Message} revoked_msg The message that was revoked, before it was revoked. It will contain the message's original data.
 * Note that due to the way this data is captured, it may be possible that this param will be undefined. 
 */
this.emit(Events.MESSAGE_REVOKED_EVERYONE, message, revoked_msg);
}

});

await page.exposeFunction('onChangeMessageEvent', (msg) => {

if (msg.type !== 'revoked') {
last_message = msg;
}

/** 
 * The event notification that is received when one of 
 * the group participants changes their phone number. 
 */
const isParticipant = msg.type === 'gp2' && msg.subtype === 'modify';

/** 
 * The event notification that is received when one of 
 * the contacts changes their phone number. 
 */
const isContact = msg.type === 'notification_template' && msg.subtype === 'change_number';

if (isParticipant || isContact) {
/** @type {GroupNotification} object does not provide enough information about this event, so a @type {Message} object is used. */
const message = new Message(this, msg);

const newId = isParticipant ? msg.recipients[0] : msg.to;
const oldId = isParticipant ? msg.author : msg.templateParams.find(id => id !== newId);

/** 
 * Emitted when a contact or a group participant changes their phone number. 
 * @event Client#contact_changed 
 * @param {Message} message Message with more information about the event. 
 * @param {String} oldId The user's id (an old one) who changed their phone number 
 * and who triggered the notification. 
 * @param {String} newId The user's new id after the change. 
 * @param {Boolean} isContact Indicates if a contact or a group participant changed their phone number. 
 */
this.emit(Events.CONTACT_CHANGED, message, oldId, newId, isContact);
}
});

await page.exposeFunction('onRemoveMessageEvent', (msg) => {

if (!msg.isNewMsg) return;

const message = new Message(this, msg);

/** 
 * Emitted when a message is deleted by the current user. 
 * @event Client#message_revoke_me 
 * @param {Message} message The message that was revoked 
 */
this.emit(Events.MESSAGE_REVOKED_ME, message);

});

await page.exposeFunction('onMessageAckEvent', (msg, ack) => {

const message = new Message(this, msg);

/** 
 * Emitted when an ack event occurrs on message type. 
 * @event Client#message_ack 
 * @param {Message} message The message that was affected 
 * @param {MessageAck} ack The new ACK value 
 */
this.emit(Events.MESSAGE_ACK, message, ack);

});

await page.exposeFunction('onChatUnreadCountEvent', async (data) => {
const chat = await this.getChatById(data.id);

/** 
 * Emitted when the chat unread count changes 
 */
this.emit(Events.UNREAD_COUNT, chat);
});

await page.exposeFunction('onMessageMediaUploadedEvent', (msg) => {

const message = new Message(this, msg);

/** 
 * Emitted when media has been uploaded for a message sent by the client. 
 * @event Client#media_uploaded 
 * @param {Message} message The message with media that was uploaded 
 */
this.emit(Events.MEDIA_UPLOADED, message);
});

await page.exposeFunction('onAppStateChangedEvent', async (state) => {

/** 
 * Emitted when the connection state changes 
 * @event Client#change_state 
 * @param {WAState} state the new connection state 
 */
this.emit(Events.STATE_CHANGED, state);

const ACCEPTED_STATES = [WAState.CONNECTED, WAState.OPENING, WAState.PAIRING, WAState.TIMEOUT];

if (this.options.takeoverOnConflict) {
ACCEPTED_STATES.push(WAState.CONFLICT);

if (state === WAState.CONFLICT) {
setTimeout(() => {
this.mPage.evaluate(() => window.Store.AppState.takeover());
}, this.options.takeoverTimeoutMs);
}
}

if (!ACCEPTED_STATES.includes(state)) {
/** 
 * Emitted when the client has been disconnected 
 * @event Client#disconnected 
 * @param {WAState|"NAVIGATION"} reason reason that caused the disconnect 
 */
await this.authStrategy.disconnect();
this.emit(Events.DISCONNECTED, state);
this.destroy();
}
});

await page.exposeFunction('onBatteryStateChangedEvent', (state) => {
const { battery, plugged } = state;

if (battery === undefined) return;

/** 
 * Emitted when the battery percentage for the attached device changes. Will not be sent if using multi-device. 
 * @event Client#change_battery 
 * @param {object} batteryInfo 
 * @param {number} batteryInfo.battery - The current battery percentage 
 * @param {boolean} batteryInfo.plugged - Indicates if the phone is plugged in (true) or not (false) 
 * @deprecated 
 */
this.emit(Events.BATTERY_CHANGED, { battery, plugged });
});

await page.exposeFunction('onIncomingCall', (call) => {
/** 
 * Emitted when a call is received 
 * @event Client#incoming_call 
 * @param {object} call 
 * @param {number} call.id - Call id 
 * @param {string} call.peerJid - Who called 
 * @param {boolean} call.isVideo - if is video 
 * @param {boolean} call.isGroup - if is group 
 * @param {boolean} call.canHandleLocally - if we can handle in waweb 
 * @param {boolean} call.outgoing - if is outgoing 
 * @param {boolean} call.webClientShouldHandle - If Waweb should handle 
 * @param {object} call.participants - Participants 
 */
const cll = new Call(this, call);
this.emit(Events.INCOMING_CALL, cll);
});

await page.exposeFunction('onReaction', (reactions) => {
for (const reaction of reactions) {
/** 
 * Emitted when a reaction is sent, received, updated or removed 
 * @event Client#message_reaction 
 * @param {object} reaction 
 * @param {object} reaction.id - Reaction id 
 * @param {number} reaction.orphan - Orphan 
 * @param {?string} reaction.orphanReason - Orphan reason 
 * @param {number} reaction.timestamp - Timestamp 
 * @param {string} reaction.reaction - Reaction 
 * @param {boolean} reaction.read - Read 
 * @param {object} reaction.msgId - Parent message id 
 * @param {string} reaction.senderId - Sender id 
 * @param {?number} reaction.ack - Ack 
 */

this.emit(Events.MESSAGE_REACTION, new Reaction(this, reaction));
}
});

await page.exposeFunction('onRemoveChatEvent', (chat) => {
/** 
 * Emitted when a chat is removed 
 * @event Client#chat_removed 
 * @param {Chat} chat 
 */
this.emit(Events.CHAT_REMOVED, new Chat(this, chat));
});

await page.exposeFunction('onArchiveChatEvent', (chat, currState, prevState) => {
/** 
 * Emitted when a chat is archived/unarchived 
 * @event Client#chat_archived 
 * @param {Chat} chat 
 * @param {boolean} currState 
 * @param {boolean} prevState 
 */
this.emit(Events.CHAT_ARCHIVED, new Chat(this, chat), currState, prevState);
});

await page.exposeFunction('onEditMessageEvent', (msg, newBody, prevBody) => {

if (msg.type === 'revoked') {
return;
}
/** 
 * Emitted when messages are edited 
 * @event Client#message_edit 
 * @param {Message} message 
 * @param {string} newBody 
 * @param {string} prevBody 
 */
this.emit(Events.MESSAGE_EDIT, new Message(this, msg), newBody, prevBody);
});

await page.evaluate(() => {
window.Store.Msg.on('change', (msg) => { window.onChangeMessageEvent(window.WWebJS.getMessageModel(msg)); });
window.Store.Msg.on('change:type', (msg) => { window.onChangeMessageTypeEvent(window.WWebJS.getMessageModel(msg)); });
window.Store.Msg.on('change:ack', (msg, ack) => { window.onMessageAckEvent(window.WWebJS.getMessageModel(msg), ack); });
window.Store.Msg.on('change:isUnsentMedia', (msg, unsent) => { if (msg.id.fromMe && !unsent) window.onMessageMediaUploadedEvent(window.WWebJS.getMessageModel(msg)); });
window.Store.Msg.on('remove', (msg) => { if (msg.isNewMsg) window.onRemoveMessageEvent(window.WWebJS.getMessageModel(msg)); });
window.Store.Msg.on('change:body', (msg, newBody, prevBody) => { window.onEditMessageEvent(window.WWebJS.getMessageModel(msg), newBody, prevBody); });
window.Store.AppState.on('change:state', (_AppState, state) => { window.onAppStateChangedEvent(state); });
window.Store.Conn.on('change:battery', (state) => { window.onBatteryStateChangedEvent(state); });
window.Store.Call.on('add', (call) => { window.onIncomingCall(call); });
window.Store.Chat.on('remove', async (chat) => { window.onRemoveChatEvent(await window.WWebJS.getChatModel(chat)); });
window.Store.Chat.on('change:archive', async (chat, currState, prevState) => { window.onArchiveChatEvent(await window.WWebJS.getChatModel(chat), currState, prevState); });
window.Store.Msg.on('add', (msg) => {
if (msg.isNewMsg) {
if (msg.type === 'ciphertext') {
// defer message event until ciphertext is resolved (type changed) 
msg.once('change:type', (_msg) => window.onAddMessageEvent(window.WWebJS.getMessageModel(_msg)));
} else {
window.onAddMessageEvent(window.WWebJS.getMessageModel(msg));
}
}
});
window.Store.Chat.on('change:unreadCount', (chat) => { window.onChatUnreadCountEvent(chat); });

{
const module = window.Store.createOrUpdateReactionsModule;
const ogMethod = module.createOrUpdateReactions;
module.createOrUpdateReactions = ((...args) => {
window.onReaction(args[0].map(reaction => {
const msgKey = window.Store.MsgKey.fromString(reaction.msgKey);
const parentMsgKey = window.Store.MsgKey.fromString(reaction.parentMsgKey);
const timestamp = reaction.timestamp / 1000;

return { ...reaction, msgKey, parentMsgKey, timestamp };
}));

return ogMethod(...args);
}).bind(module);
}
});

/** 
 * Emitted when the client has initialized and is ready to receive messages. 
 * @event Client#ready 
 */
this.emit(Events.READY);
this.authStrategy.afterAuthReady();

// Disconnect when navigating away when in PAIRING state (detect logout) 
this.mPage.on('framenavigated', async () => {
const appState = await this.getState();
if (!appState || appState === WAState.PAIRING) {
await this.authStrategy.disconnect();
this.emit(Events.DISCONNECTED, 'NAVIGATION');
await this.destroy();
}
});
}
/*
async initWebVersionCache() {
const { type: webCacheType, ...webCacheOptions } =
this.options.webVersionCache;
const webCache = WebCacheFactory.createWebCache(
webCacheType,
webCacheOptions
);

const requestedVersion = this.options.webVersion;
const versionContent = await webCache.resolve(requestedVersion);

if (versionContent) {
await this.mPage.setRequestInterception(true);
this.mPage.on("request", async (req) => {
if (req.url() === WhatsWebURL) {
req.respond({
status: 200,
contentType: "text/html",
body: versionContent,
});
} else {
req.continue();
}
});
} else {
this.mPage.on("response", async (res) => {
if (res.ok() && res.url() === WhatsWebURL) {
await webCache.persist(await res.text());
}
});
}
}
*/

/**
 * Closes the client
 */
async destroy() {
await this.pupBrowser.close();
await this.authStrategy.destroy();
}


/**
 * Logs out the client, closing the current session
 */
async logout() {
await this.mPage.evaluate(() => {
return window.Store.AppState.logout();
});
await this.pupBrowser.close();

let maxDelay = 0;
while (this.pupBrowser.isConnected() && maxDelay < 10) {
// waits a maximum of 1 second before calling the AuthStrategy
await new Promise((resolve) => setTimeout(resolve, 100));
maxDelay++;
}

await this.authStrategy.logout();
}

/**
 * Returns the version of WhatsApp Web currently being run
 * @returns {Promise<string>}
 */
async getWWebVersion() {
return await this.mPage.evaluate(() => {
return window.Debug.VERSION;
});
}

/**
 * Mark as seen for the Chat
 *@param {string} chatId
 *@returns {Promise<boolean>} result
 *
 */
async sendSeen(chatId) {
const result = await this.mPage.evaluate(async (chatId) => {
return window.WWebJS.sendSeen(chatId);
}, chatId);
return result;
}

/**
 * Message options.
 * @typedef {Object} MessageSendOptions
 * @property {boolean} [linkPreview=true] - Show links preview. Has no effect on multi-device accounts.
 * @property {boolean} [sendAudioAsVoice=false] - Send audio as voice message with a generated waveform
 * @property {boolean} [sendVideoAsGif=false] - Send video as gif
 * @property {boolean} [sendMediaAsSticker=false] - Send media as a sticker
 * @property {boolean} [sendMediaAsDocument=false] - Send media as a document
 * @property {boolean} [isViewOnce=false] - Send photo/video as a view once message
 * @property {boolean} [parseVCards=true] - Automatically parse vCards and send them as contacts
 * @property {string} [caption] - Image or video caption
 * @property {string} [quotedMessageId] - Id of the message that is being quoted (or replied to)
 * @property {Contact[]} [mentions] - Contacts that are being mentioned in the message
 * @property {boolean} [sendSeen=true] - Mark the conversation as seen after sending the message
 * @property {string} [stickerAuthor=undefined] - Sets the author of the sticker, (if sendMediaAsSticker is true).
 * @property {string} [stickerName=undefined] - Sets the name of the sticker, (if sendMediaAsSticker is true).
 * @property {string[]} [stickerCategories=undefined] - Sets the categories of the sticker, (if sendMediaAsSticker is true). Provide emoji char array, can be null.
 * @property {MessageMedia} [media] - Media to be sent
 */

/**
 * Send a message to a specific chatId
 * @param {string} chatId
 * @param {string|MessageMedia|Location|Contact|Array<Contact>|Buttons|List} content
 * @param {MessageSendOptions} [options] - Options used when sending the message
 *
 * @returns {Promise<Message>} Message that was just sent
 */
async sendMessage(chatId, content, options = {}) {
let internalOptions = {
linkPreview: options.linkPreview,
sendAudioAsVoice: options.ptt,
sendVideoAsGif: options.gifPlayBack,
sendMediaAsSticker: options.asSticker,
sendMediaAsDocument: options.asDocument,
caption: options.caption,
quotedMessageId: options.quoted?.id
? options.quoted._serialized || options.quoted.id._serialized
: options.quoted,
parseVCards: options.parseVCards === false ? false : true,
mentionedJidList: Array.isArray(options.mentions)
? options.mentions.map((contact) =>
contact?.id ? contact?.id?._serialized : contact
)
: [],
extraOptions: options.extra,
};

if (options.caption) internalOptions.caption = options.caption;
const sendSeen =
typeof options.sendSeen === "undefined" ? true : options.sendSeen;

if (
Buffer.isBuffer(content) ||
/^[a-zA-Z0-9+/]*={0,2}$/i.test(content) ||
/^data:.*?\/.*?;base64,/i.test(content) ||
/^https?:\/\//.test(content) ||
fs.existsSync(content)
) {
let media = await Util.getFile(content);
let ex = typeof media === "undefined" ? ".bin" : media.ext;
console.log(`anu
${xutil.format(media)}
ok: ${ex}`)
if (!options.mimetype && ex === ".bin" || ex === ".html") {
content = content;
} else {
internalOptions.attachment = {
mimetype: options.mimetype ? options.mimetype : media.mime,
data:
media?.data?.toString("base64") || Util.bufferToBase64(media.data),
filename: options.fileName
? options.fileName
: Util.getRandom(media.ext),
filesize: options.fileSize ? options.fileSize : media.size,
};
content = "";
}
} else if (content instanceof MessageMedia) {
internalOptions.attachment = content;
content = "";
} else if (options.media instanceof MessageMedia) {
internalOptions.attachment = options.media;
internalOptions.caption = content;
content = "";
} else if (content instanceof Location) {
internalOptions.location = content;
content = "";
} else if (content instanceof Contact) {
internalOptions.contactCard = content.id
? content.id._serialized
: content;
content = "";
} else if (
Array.isArray(content) &&
content.length > 0 &&
content[0] instanceof Contact
) {
internalOptions.contactCardList = content.map((contact) =>
contact.id ? contact.id._serialized : contact
);
content = "";
} else if (content instanceof Buttons) {
if (content.type !== "chat") {
internalOptions.attachment = content.body;
}
internalOptions.buttons = content;
content = "";
} else if (content instanceof List) {
internalOptions.list = content;
content = "";
}

if (internalOptions.sendMediaAsSticker && internalOptions.attachment) {
internalOptions.attachment = await Util.formatToWebpSticker(
internalOptions.attachment,
{
packId: options?.packId ? options.packId : global?.Exif?.packId,
packName: options?.packName
? options.packName
: global?.Exif?.packName,
packPublish: options?.packPublish
? options.packPublish
: global?.Exif?.packPublish,
packEmail: options?.packEmail
? options.packEmail
: global?.Exif?.packEmail,
packWebsite: options?.packWebsite
? options.packWebsite
: global?.Exif?.packWebsite,
androidApp: options?.androidApp
? options.androidApp
: global?.Exif?.androidApp,
iOSApp: options?.iOSApp ? options.iOSApp : global?.Exif?.iOSApp,
categories: options?.categories
? options.categories
: global?.Exif?.categories,
isAvatar: options?.isAvatar
? options.isAvatar
: global?.Exif?.isAvatar,
},
this.mPage
);
}
const newMessage = await this.mPage.evaluate(
async (chatId, message, options, sendSeen) => {
const chatWid = window.Store.WidFactory.createWid(chatId);
const chat = await window.Store.Chat.find(chatWid);

if (sendSeen) {
window.WWebJS.sendSeen(chatId);
}

const msg = await window.WWebJS.sendMessage(
chat,
message,
options,
sendSeen
);
return msg.serialize();
},
chatId,
content,
internalOptions,
sendSeen
)
if (newMessage) return new Message(this, newMessage);
}

/**
 * Searches for messages
 * @param {string} query
 * @param {Object} [options]
 * @param {number} [options.page]
 * @param {number} [options.limit]
 * @param {string} [options.chatId]
 * @returns {Promise<Message[]>}
 */
async searchMessages(query, options = {}) {
const messages = await this.mPage.evaluate(
async (query, page, count, remote) => {
const { messages } = await window.Store.Msg.search(
query,
page,
count,
remote
);
return messages.map((msg) => window.WWebJS.getMessageModel(msg));
},
query,
page,
count,
remote
);

return messages.map((msg) => new Message(this, msg));
}

/**
 * Get all current chat instances
 * @returns {Promise<Array<Chat>>}
 */
async getChats() {
let chats = await this.mPage.evaluate(async () => {
return await window.WWebJS.getChats();
});

return chats.map((chat) => ChatFactory.create(this, chat));
}

/**
 * Get chat instance by ID
 * @param {string} chatId
 * @returns {Promise<Chat>}
 */
async getChatById(chatId) {
let chat = await this.mPage.evaluate(async (chatId) => {
return await window.WWebJS.getChat(chatId);
}, chatId);

return ChatFactory.create(this, chat);
}

/**
 * Get all current contact instances
 * @returns {Promise<Array<Contact>>}
 */
async getContacts() {
let contacts = await this.mPage.evaluate(() => {
return window.WWebJS.getContacts();
});

return contacts.map((contact) => ContactFactory.create(this, contact));
}

/**
 * Get contact instance by ID
 * @param {string} contactId
 * @returns {Promise<Contact>}
 */
async getContactById(contactId) {
let contact = await this.mPage.evaluate((contactId) => {
return window.WWebJS.getContact(contactId);
}, contactId);

return ContactFactory.create(this, contact);
}

async getMessageById(messageId) {
const msg = await this.mPage.evaluate(async (messageId) => {
let msg = window.Store.Msg.get(messageId);
if (msg) return window.WWebJS.getMessageModel(msg);

const params = messageId.split("_");
if (params.length !== 3)
throw new Error("Invalid serialized message id specified");

let messagesObject = await window.Store.Msg.getMessagesById([messageId]);
if (messagesObject && messagesObject.messages.length)
msg = messagesObject.messages[0];

if (msg) return window.WWebJS.getMessageModel(msg);
}, messageId);

if (msg) return new Message(this, msg);
return null;
}

/**
 * Returns an object with information about the invite code's group
 * @param {string} inviteCode
 * @returns {Promise<object>} Invite information
 */
async getInviteInfo(inviteCode) {
return await this.mPage.evaluate((inviteCode) => {
return window.Store.InviteInfo.queryGroupInvite(inviteCode);
}, inviteCode);
}

/**
 * Accepts an invitation to join a group
 * @param {string} inviteCode Invitation code
 * @returns {Promise<string>} Id of the joined Chat
 */
async acceptInvite(inviteCode) {
const res = await this.mPage.evaluate(async (inviteCode) => {
return await window.Store.Invite.joinGroupViaInvite(inviteCode);
}, inviteCode);

return res.gid._serialized;
}

/**
 * Accepts a private invitation to join a group
 * @param {object} inviteInfo Invite V4 Info
 * @returns {Promise<Object>}
 */
async acceptGroupV4Invite(inviteInfo) {
if (!inviteInfo.inviteCode)
throw "Invalid invite code, try passing the message.inviteV4 object";
if (inviteInfo.inviteCodeExp == 0) throw "Expired invite code";
return this.mPage.evaluate(async (inviteInfo) => {
let { groupId, fromId, inviteCode, inviteCodeExp } = inviteInfo;
let userWid = window.Store.WidFactory.createWid(fromId);
return await window.Store.JoinInviteV4.joinGroupViaInviteV4(
inviteCode,
String(inviteCodeExp),
groupId,
userWid
);
}, inviteInfo);
}

/**
 * Sets the current user's status message
 * @param {string} status New status message
 */
async setStatus(status) {
await this.mPage.evaluate(async (status) => {
return await window.Store.StatusUtils.setMyStatus(status);
}, status);
}

/**
 * Sets the current user's display name.
 * This is the name shown to WhatsApp users that have not added you as a contact beside your number in groups and in your profile.
 * @param {string} displayName New display name
 * @returns {Promise<Boolean>}
 */
async setDisplayName(displayName) {
const couldSet = await this.mPage.evaluate(async (displayName) => {
if (!window.Store.Conn.canSetMyPushname()) return false;

if (window.Store.MDBackend) {
// TODO
return false;
} else {
const res = await window.Store.Wap.setPushname(displayName);
return !res.status || res.status === 200;
}
}, displayName);

return couldSet;
}

/**
 * Gets the current connection state for the client
 * @returns {WAState}
 */
async getState() {
return await this.mPage.evaluate(() => {
if (!window.Store) return null;
return window.Store.AppState.state;
});
}

/**
 * Marks the client as online
 */
async sendPresenceAvailable() {
return await this.mPage.evaluate(() => {
return window.Store.PresenceUtils.sendPresenceAvailable();
});
}

/**
 * Marks the client as unavailable
 */
async sendPresenceUnavailable() {
return await this.mPage.evaluate(() => {
return window.Store.PresenceUtils.sendPresenceUnavailable();
});
}

/**
 * Enables and returns the archive state of the Chat
 * @returns {boolean}
 */
async archiveChat(chatId) {
return await this.mPage.evaluate(async (chatId) => {
let chat = await window.Store.Chat.get(chatId);
await window.Store.Cmd.archiveChat(chat, true);
return true;
}, chatId);
}

/**
 * Changes and returns the archive state of the Chat
 * @returns {boolean}
 */
async unarchiveChat(chatId) {
return await this.mPage.evaluate(async (chatId) => {
let chat = await window.Store.Chat.get(chatId);
await window.Store.Cmd.archiveChat(chat, false);
return false;
}, chatId);
}

/**
 * Pins the Chat
 * @returns {Promise<boolean>} New pin state. Could be false if the max number of pinned chats was reached.
 */
async pinChat(chatId) {
return this.mPage.evaluate(async (chatId) => {
let chat = window.Store.Chat.get(chatId);
if (chat.pin) {
return true;
}
const MAX_PIN_COUNT = 3;
const chatModels = window.Store.Chat.getModelsArray();
if (chatModels.length > MAX_PIN_COUNT) {
let maxPinned = chatModels[MAX_PIN_COUNT - 1].pin;
if (maxPinned) {
return false;
}
}
await window.Store.Cmd.pinChat(chat, true);
return true;
}, chatId);
}

/**
 * Unpins the Chat
 * @returns {Promise<boolean>} New pin state
 */
async unpinChat(chatId) {
return this.mPage.evaluate(async (chatId) => {
let chat = window.Store.Chat.get(chatId);
if (!chat.pin) {
return false;
}
await window.Store.Cmd.pinChat(chat, false);
return false;
}, chatId);
}

/**
 * Mutes this chat forever, unless a date is specified
 * @param {string} chatId ID of the chat that will be muted
 * @param {?Date} unmuteDate Date when the chat will be unmuted, leave as is to mute forever
 */
async muteChat(chatId, unmuteDate) {
unmuteDate = unmuteDate ? unmuteDate.getTime() / 1000 : -1;
await this.mPage.evaluate(
async (chatId, timestamp) => {
let chat = await window.Store.Chat.get(chatId);
await chat.mute.mute({ expiration: timestamp, sendDevice: !0 });
},
chatId,
unmuteDate || -1
);
}

/**
 * Unmutes the Chat
 * @param {string} chatId ID of the chat that will be unmuted
 */
async unmuteChat(chatId) {
await this.mPage.evaluate(async (chatId) => {
let chat = await window.Store.Chat.get(chatId);
await window.Store.Cmd.muteChat(chat, false);
}, chatId);
}

/**
 * Mark the Chat as unread
 * @param {string} chatId ID of the chat that will be marked as unread
 */
async markChatUnread(chatId) {
await this.mPage.evaluate(async (chatId) => {
let chat = await window.Store.Chat.get(chatId);
await window.Store.Cmd.markChatUnread(chat, true);
}, chatId);
}

/**
 * Returns the contact ID's profile picture URL, if privacy settings allow it
 * @param {string} contactId the whatsapp user's ID
 * @returns {Promise<string>}
 */
async getProfilePicUrl(contactId) {
const profilePic = await this.mPage.evaluate(async (contactId) => {
try {
const chatWid = window.Store.WidFactory.createWid(contactId);
return await window.Store.ProfilePic.profilePicFind(chatWid);
} catch (err) {
if (err.name === "ServerStatusCodeError") return undefined;
throw err;
}
}, contactId);

return profilePic ? profilePic.eurl : undefined;
}

/**
 * Gets the Contact's common groups with you. Returns empty array if you don't have any common group.
 * @param {string} contactId the whatsapp user's ID (_serialized format)
 * @returns {Promise<WAWebJS.ChatId[]>}
 */
async getCommonGroups(contactId) {
const commonGroups = await this.mPage.evaluate(async (contactId) => {
let contact = window.Store.Contact.get(contactId);
if (!contact) {
const wid = window.Store.WidFactory.createUserWid(contactId);
const chatConstructor = window.Store.Contact.getModelsArray().find(
(c) => !c.isGroup
).constructor;
contact = new chatConstructor({ id: wid });
}

if (contact.commonGroups) {
return contact.commonGroups.serialize();
}
const status = await window.Store.findCommonGroups(contact);
if (status) {
return contact.commonGroups.serialize();
}
return [];
}, contactId);
const chats = [];
for (const group of commonGroups) {
chats.push(group.id);
}
return chats;
}

/**
 * Force reset of connection state for the client
 */
async resetState() {
await this.mPage.evaluate(() => {
window.Store.AppState.phoneWatchdog.shiftTimer.forceRunNow();
});
}

/**
 * Check if a given ID is registered in whatsapp
 * @param {string} id the whatsapp user's ID
 * @returns {Promise<Boolean>}
 */
async isRegisteredUser(id) {
return Boolean(await this.getNumberId(id));
}

/**
 * Get the registered WhatsApp ID for a number.
 * Will return null if the number is not registered on WhatsApp.
 * @param {string} number Number or ID ("@c.us" will be automatically appended if not specified)
 * @returns {Promise<Object|null>}
 */
async getNumberId(number) {
if (!number.endsWith("@c.us")) {
number += "@c.us";
}

return await this.mPage.evaluate(async (number) => {
const wid = window.Store.WidFactory.createWid(number);
const result = await window.Store.QueryExist(wid);
if (!result || result.wid === undefined) return null;
return result.wid;
}, number);
}

/**
 * Get the formatted number of a WhatsApp ID.
 * @param {string} number Number or ID
 * @returns {Promise<string>}
 */
async getFormattedNumber(number) {
if (!number.endsWith("@s.whatsapp.net"))
number = number.replace("c.us", "s.whatsapp.net");
if (!number.includes("@s.whatsapp.net"))
number = `${number}@s.whatsapp.net`;

return await this.mPage.evaluate(async (numberId) => {
return window.Store.NumberInfo.formattedPhoneNumber(numberId);
}, number);
}

/**
 * Get the country code of a WhatsApp ID.
 * @param {string} number Number or ID
 * @returns {Promise<string>}
 */
async getCountryCode(number) {
number = number.replace(" ", "").replace("+", "").replace("@c.us", "");

return await this.mPage.evaluate(async (numberId) => {
return window.Store.NumberInfo.findCC(numberId);
}, number);
}

/**
 * Create a new group
 * @param {string} name group title
 * @param {Array<Contact|string>} participants an array of Contacts or contact IDs to add to the group
 * @returns {Object} createRes
 * @returns {string} createRes.gid - ID for the group that was just created
 * @returns {Object.<string,string>} createRes.missingParticipants - participants that were not added to the group. Keys represent the ID for participant that was not added and its value is a status code that represents the reason why participant could not be added. This is usually 403 if the user's privacy settings don't allow you to add them to groups.
 */
async createGroup(name, participants) {
if (!Array.isArray(participants) || participants.length == 0) {
throw "You need to add at least one other participant to the group";
}

if (participants.every((c) => c instanceof Contact)) {
participants = participants.map((c) => c.id._serialized);
}

const createRes = await this.mPage.evaluate(
async (name, participantIds) => {
const participantWIDs = participantIds.map((p) =>
window.Store.WidFactory.createWid(p)
);
return await window.Store.GroupUtils.createGroup(
name,
participantWIDs,
0
);
},
name,
participants
);

const missingParticipants = createRes.participants.reduce((missing, c) => {
const id = c.wid._serialized;
const statusCode = c.error ? c.error.toString() : "200";
if (statusCode != 200)
return Object.assign(missing, { [id]: statusCode });
return missing;
}, {});

return { gid: createRes.wid, missingParticipants };
}

/**
 * Get all current Labels
 * @returns {Promise<Array<Label>>}
 */
async getLabels() {
const labels = await this.mPage.evaluate(async () => {
return window.WWebJS.getLabels();
});

return labels.map((data) => new Label(this, data));
}

/**
 * Get Label instance by ID
 * @param {string} labelId
 * @returns {Promise<Label>}
 */
async getLabelById(labelId) {
const label = await this.mPage.evaluate(async (labelId) => {
return window.WWebJS.getLabel(labelId);
}, labelId);

return new Label(this, label);
}

/**
 * Get all Labels assigned to a chat
 * @param {string} chatId
 * @returns {Promise<Array<Label>>}
 */
async getChatLabels(chatId) {
const labels = await this.mPage.evaluate(async (chatId) => {
return window.WWebJS.getChatLabels(chatId);
}, chatId);

return labels.map((data) => new Label(this, data));
}

/**
 * Get all Chats for a specific Label
 * @param {string} labelId
 * @returns {Promise<Array<Chat>>}
 */
async getChatsByLabelId(labelId) {
const chatIds = await this.mPage.evaluate(async (labelId) => {
const label = window.Store.Label.get(labelId);
const labelItems = label.labelItemCollection.getModelsArray();
return labelItems.reduce((result, item) => {
if (item.parentType === "Chat") {
result.push(item.parentId);
}
return result;
}, []);
}, labelId);

return Promise.all(chatIds.map((id) => this.getChatById(id)));
}

/**
 * Gets all blocked contacts by host account
 * @returns {Promise<Array<Contact>>}
 */
async getBlockedContacts() {
const blockedContacts = await this.mPage.evaluate(() => {
let chatIds = window.Store.Blocklist.getModelsArray().map(
(a) => a.id._serialized
);
return Promise.all(chatIds.map((id) => window.WWebJS.getContact(id)));
});

return blockedContacts.map((contact) =>
ContactFactory.create(this.client, contact)
);
}

/**
 * Sets the current user's profile picture.
 * @param {MessageMedia} media
 * @returns {Promise<boolean>} Returns true if the picture was properly updated.
 */
async setProfilePicture(media) {
const success = await this.mPage.evaluate(
(chatid, media) => {
return window.WWebJS.setPicture(chatid, media);
},
this.info.wid._serialized, media
);

return success;
}

/**
 * Deletes the current user's profile picture.
 * @returns {Promise<boolean>} Returns true if the picture was properly deleted.
 */
async deleteProfilePicture() {
const success = await this.mPage.evaluate((chatid) => {
return window.WWebJS.deletePicture(chatid);
}, this.info.wid._serialized);

return success;
}

/**
 * Change labels in chats
 * @param {Array<number|string>} labelIds
 * @param {Array<string>} chatIds
 * @returns {Promise<void>}
 */
async addOrRemoveLabels(labelIds, chatIds) {
return this.mPage.evaluate(
async (labelIds, chatIds) => {
if (["smba", "smbi"].indexOf(window.Store.Conn.platform) === -1) {
throw "[LT01] Only Whatsapp business";
}
const labels = window.WWebJS.getLabels().filter(
(e) => labelIds.find((l) => l == e.id) !== undefined
);
const chats = window.Store.Chat.filter((e) =>
chatIds.includes(e.id._serialized)
);

let actions = labels.map((label) => ({ id: label.id, type: "add" }));

chats.forEach((chat) => {
(chat.labels || []).forEach((n) => {
if (!actions.find((e) => e.id == n)) {
actions.push({ id: n, type: "remove" });
}
});
});

return await window.Store.Label.addOrRemoveLabels(actions, chats);
},
labelIds,
chatIds
);
}

/**
 * group metadata
 * @param {*} chatId
 * @returns
 */
async groupMetadata(chatId) {
let chat = await this.mPage.evaluate(async (chatId) => {
let chatWid = await window.Store.WidFactory.createWid(chatId);
let chat = await window.Store.GroupMetadata.find(chatWid);

return chat.serialize();
}, chatId);

if (!chat) return false;
return chat;
}

/**
 * get name whatsapp
 * @param {*} jid
 * @returns
 */
async getName(jid) {
const contact = await this.getContactById(jid);
return (
contact.name || contact.pushname || contact.shortName || contact.number
);
}

/**
 * screenshot whatsapp
 * @returns
 */
async myPage() {
await this.mPage.setViewportSize({
width: 961,
height: 2000,
});
let media = await this.mPage.screenshot();
let upload = await Util.upload(media);
return upload.url;
}
// end
}

module.exports = Client;
