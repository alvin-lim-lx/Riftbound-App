"use strict";
// Utility functions
Object.defineProperty(exports, "__esModule", { value: true });
exports.deepClone = deepClone;
exports.randomId = randomId;
exports.shuffle = shuffle;
exports.clamp = clamp;
exports.pickRandom = pickRandom;
exports.sleep = sleep;
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}
function randomId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
