const jsforce = require('jsforce'); // https://jsforce.github.io/document/
const readline = require('readline');

const pass = `${process.env['SALESFORCE_PW']}${process.env['SALESFORCE_SECURITY_TOKEN']}`;
const email = process.env['SALESFORCE_EMAIL'];
const conn = new jsforce.Connection({});

const r1 = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

conn.login(
  email,
  pass,
  async function (err, userInfo) {
    if (err) {
      throw err;
    }
    console.log("Successfully logged in: ", userInfo);
  }
);

console.log("Input an object and get a list of all fields: ");
r1.on("line", (userInput) => {
  // Print user input in console.
  console.log("--------------------------");
  conn.describe(userInput).then((resp) => {
    let fields = resp.fields.map((f) => {
      return f.name;
    }).sort();
    console.log(`${userInput} fields:`, JSON.stringify(fields, null, 2));
    console.log("--------------------------");
  });
});