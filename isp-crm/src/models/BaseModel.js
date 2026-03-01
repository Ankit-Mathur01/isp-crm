// src/models/BaseModel.js
const { query, buildInsert, buildUpdate, paginate } = require('../config/database');

class BaseModel {
  constructor(tableName) {
    this.table = tableName;
  }

  async findById(id, columns = '*') {
    const result = await query(
      `SELECT ${columns} FROM ${this.table} WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  async findAll({ where = {}, orderBy = 'created_at DESC', page = 1, pageSize = 20, columns = '*' } = {}) {
    const { limit, offset } = paginate(page, pageSize);
    const keys   = Object.keys(where);
    const values = Object.values(where);
    const conditions = keys.length
      ? 'WHERE ' + keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ')
      : '';

    const countResult = await query(
      `SELECT COUNT(*) FROM ${this.table} ${conditions}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await query(
      `SELECT ${columns} FROM ${this.table} ${conditions} ORDER BY ${orderBy} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );

    return {
      data: dataResult.rows,
      pagination: { total, page: parseInt(page), pageSize: limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async create(data) {
    const { text, values } = buildInsert(this.table, data);
    const result = await query(text, values);
    return result.rows[0];
  }

  async update(id, data) {
    const { text, values } = buildUpdate(this.table, data, { id });
    const result = await query(text, values);
    return result.rows[0] || null;
  }

  async delete(id) {
    const result = await query(
      `DELETE FROM ${this.table} WHERE id = $1 RETURNING id`,
      [id]
    );
    return result.rowCount > 0;
  }

  async exists(where) {
    const keys   = Object.keys(where);
    const values = Object.values(where);
    const cond   = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
    const result = await query(`SELECT 1 FROM ${this.table} WHERE ${cond} LIMIT 1`, values);
    return result.rowCount > 0;
  }
}

module.exports = BaseModel;
