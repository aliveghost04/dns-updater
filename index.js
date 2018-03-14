'use strict';

const request = require('request-promise');
const mysql = require('mysql');
const cron = require('node-cron');
const baseUrl = 'https://api.cloudflare.com/client/v4/';
const ipCheckUrl = 'https://ifconfig.co/json';
let lastIp;

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  connectionLimit: 2
});

pool.getConnection((err, connection) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  connection.query(
    `SELECT ip FROM history ORDER BY last_update DESC LIMIT 1`,
    (err, results) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }

      if (results.length === 1) {
        lastIp = results[0].ip;
      }

      connection.release();
    }
  );
});

cron.schedule('*/5 * * * *', () => {
  request({
    uri: ipCheckUrl,
    json: true
  })
  .then(data => {
    if (data.ip !== lastIp) {
      lastIp = data.ip;

      pool.query(
        `INSERT INTO history
        VALUES(NULL, ?, NOW(), ?)`,
        [ data.ip, JSON.stringify(data) ],
        (err, results) => {
          if (err) {
            console.error(err);
            return;
          }

          lastIp = data.ip;
        }
      );

      request({
        baseUrl,
        uri: `zones/${process.env.DNS_ZONE_ID}/dns_records/${process.env.DNS_ZONE_RECORD_ID}`,
        method: 'PUT',
        headers: {
          'X-Auth-Key': process.env.AUTH_KEY,
          'X-Auth-Email': process.env.AUTH_EMAIL
        },
        json: true,
        body: {
          type: "A",
          name: process.env.DOMAIN_NAME,
          content: data.ip,
          ttl: 300
        }
      })
      .then(console.log)
      .catch(console.error);
    }

  })
  .catch(console.error)
});