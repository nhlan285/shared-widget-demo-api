// Thin helpers over Cloudflare D1 (SQLite). Schema: migrations/*.sql
const { db } = require("./cloudflare");

const statement = (sql, params = []) => db().prepare(sql).bind(...params);

/**
 * Lấy 1 dòng đầu tiên
 * @param {string} sql - Câu SQL
 * @param {Array} params - Tham số
 * @return {Promise<Object|null>}
 */
const get = (sql, params) => statement(sql, params).first();

/**
 * Lấy tất cả các dòng
 * @param {string} sql - Câu SQL
 * @param {Array} params - Tham số
 * @return {Promise<Array<Object>>}
 */
const all = async (sql, params) => (await statement(sql, params).all()).results;

/**
 * Chạy INSERT/UPDATE/DELETE, kết quả có meta.changes
 * @param {string} sql - Câu SQL
 * @param {Array} params - Tham số
 * @return {Promise<Object>}
 */
const run = (sql, params) => statement(sql, params).run();

module.exports = { get, all, run };
