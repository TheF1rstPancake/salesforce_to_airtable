const jsforce = require('jsforce'); // https://jsforce.github.io/document/
const airtable = require('airtable');

// pull in our config file which details how objects in SFDC 
// map to our objects in AT
const config = require('./config');


/**
 * Issue a SOQL query to SFDC.  This function will paginate and return the full set of records upon completion
 * @param {jsforce Connection} conn 
 * @param {string} soql  Salesforce SOQL query to execute
 */
async function asyncQuery(conn, soql) {
  var done = false;
  var next_record_url = null;
  var results = {
    records: [],
  };
  while (!done) {
    var p = null;
    if (next_record_url === null) {
      p = new Promise((resolve, reject) => {
        conn.query(soql, function (err, result) {
          if (err) {
            reject(err);
            return;
          }
          resolve(result);
        })
      });
    } else {
      console.log("Fetching next page of records");
      p = new Promise((resolve, reject) => {
        conn.queryMore(next_record_url, function (err, result) {
          if (err) {
            reject(err)
            return;
          }
          resolve(result);
        })
      })
    }
    let res = await p;
    done = res.done;
    next_record_url = res.nextRecordsUrl;

    results.records = [...results.records, ...res.records];
  }
  return results;
}


/**
 * Build the SOQL query for pulling data out of SFDC
 * @param {<string>[]} fields 
 * @param {string} object 
 * @param {Object} opts 
 */
function buildQuery(fields, object, opts) {
  var fields_to_select = Object.keys(fields).join(",");
  var q = `SELECT ${fields_to_select} FROM ${object}`

  // if we have a set of IDs or a WHERE clause to apply, this is where we build it
  // the WHERE clause options is always applied first if present
  if (opts.objectIds !== undefined || opts.whereClause !== undefined) {
    q += ' WHERE ';
    if (opts.whereClause !== undefined) {
      q += ` ${opts.whereClause} `;
    }
    if (opts.objectIds !== undefined) {
      let ids = opts.objectIds.map(p => {
        return `'${p}'`
      }).join(',');
      q += `${opts.filterFieldName} in (${ids})`
    }
  }
  return q;
}

/**
 * Pull att Airtable records from this table and create a map of primary field to Airtable record ID
 * @param {airtable base} base 
 * @param {string} tableName 
 * @param {string} primaryFieldName 
 */
async function pullAirtableRecords(base, tableName, primaryFieldName) {
  var records = await base(tableName).select().all();

  var map = {};
  for (var r of records) {
    map[r.get(primaryFieldName)] = r.id;
  }
  return map;
}

async function bulkAirtableOp(base, tableName, funcName, records) {
  var results = [];
  var queue = [];

  // create a queue of batched payloads
  while (records.length > 0) {
    var p = null;
    if (funcName === 'destroy') {
      p = base(tableName)[funcName](
        records.slice(0, 10)
      );

    } else {
      p = base(tableName)[funcName](
        records.slice(0, 10), {
          typecast: true
        }
      );

    }
    // queue the request
    queue.push(p);

    // decrease our record set
    records = records.slice(10);

    // if we have RATE_LIMIT number of records in the queue
    // or we've run out of records, 
    // then wait for theses records to finish before continuing to the next set
    if (queue.length === 5 || records.length === 0) {
      let new_records = await Promise.all(queue.slice(0, 5));
      for (let batch of new_records) {
        results = [...results, ...batch];
      }
      queue = [];
    }
  }
}

/**
 * Compare the set of IDs in Airtable versus a set of salesforce IDs.  
 * The difference between them will be the set of records we want to delete from the base
 * @param {Object} airtable_map       dictionary where the keys are SFDC Ids and values are Airtable reocrd IDs
 * @param {<string>[]} salesforce_ids array of SFDC ids      
 */
function findRecordsToDelete(airtable_map, salesforce_ids) {
  let airtable_sfdc_ids = new Set(Object.keys(airtable_map));
  let sfdc_ids = new Set(salesforce_ids);

  let difference = [...airtable_sfdc_ids].filter(x => !sfdc_ids.has(x))

  let records_to_delete = difference.map((v) => {
    return airtable_map[v];
  });
  return records_to_delete;
}

/**
 * Take a Salesforce object, fetch data from that object, and push into a corresponding Airtable table 
 * @param {jsforce conn} conn 
 * @param {airtable base} base 
 * @param {Object} map_object 
 * @param {striing} object_name 
 * @param {Object} query_opts 
 */
async function salesforceToAirtable(conn, base, map_object, object_name, query_opts) {
  // get all of our data from salesforce
  // query opts is an object here in case there are other configurable options we want to add in the future
  var query = buildQuery(map_object.fields, object_name, query_opts);
  console.log("Sending query: ", query);
  var results = await asyncQuery(conn, query);

  console.log("Received responses: ", results.records.length);
  console.log("Sample response: ", JSON.stringify(results.records[0], null, 2));

  // get all of the corresponding records from Airtable
  // this will be an object where the key is the primary field
  // and the value is the underlying Airtable record ID, which we will
  // need to do linked records
  var record_map = await pullAirtableRecords(
    base,
    map_object.table,
    map_object.primaryAirtableFieldName
  );

  // for each record, prep to push it into Airtable
  // use our field mapping to define how the records should map
  // additionally, if we have a return value defined, use this opportunity to prepare that return object

  var create_payloads = [];
  var update_payloads = [];
  var returnValue = {};
  var sfdcPrimaryField = map_object.primarySalesforceFieldName;
  console.log("Checking SFDC primary field: ", sfdcPrimaryField);
  for (let r of results.records) {
    var p = {
      fields: {}
    };
    let sfdc_fields = map_object.fields;
    for (let k in sfdc_fields) {
      let at_field = sfdc_fields[k];
      p.fields[at_field] = r[k];
      if (k === map_object.returnValue) {
        returnValue[r[k]] = null;
      }
    }

    let existing_record_id = record_map[r[sfdcPrimaryField]];
    if (existing_record_id !== undefined) {
      p.id = existing_record_id;
      update_payloads.push(p);
    } else {
      create_payloads.push(p);
    }
  };

  // finally, this is also our opportunity to determine if some existing records in the Airtable base
  // no longer match our criteria and should be removed
  var sfdc_ids = results.records.map((r) => {
    return r[sfdcPrimaryField]
  });
  var delete_payloads = findRecordsToDelete(record_map, sfdc_ids);


  // Push the data to Airtable
  // in this case, typecast becomes incredibly useful
  // If we use the SFDC ID as the primary field for all records
  // then we have a guarantee that they are always unique
  // (the same cannot be said if you use Account Name for example)
  // When pulling one object, we can then 
  console.log("Pushing to Airtable");
  console.log(`Creating ${create_payloads.length} records`);
  var new_records = await bulkAirtableOp(base, map_object.table, 'create', create_payloads);

  // update our record map with the new records
  //for (var r of new_records) {
  //  record_map[sfdcPrimaryField] = r.id;
  //}

  console.log(`Updating ${update_payloads.length} records`);
  await bulkAirtableOp(base, map_object.table, 'update', update_payloads);

  console.log(`Deleting ${delete_payloads.length} records`);
  await bulkAirtableOp(base, map_object.table, 'destroy', delete_payloads);

  return returnValue;
}

async function run(conn, base_id, sfdc_to_at) {
  const base = airtable.base(base_id);
  var query_opts = {};
  for (var obj_name in sfdc_to_at) {
    let obj = sfdc_to_at[obj_name]
    console.log("Prepping to query: ", obj);
    if (obj.filterFieldName !== undefined) {
      query_opts.filterFieldName = obj.filterFieldName;
    }
    if (obj.whereClause !== undefined) {
      query_opts.whereClause = obj.whereClause;
    }
    let ids = await salesforceToAirtable(
      conn,
      base,
      obj,
      obj_name,
      query_opts
    );
    console.log("Returning data");
    query_opts = {
      objectIds: Object.keys(ids)
    }
  }

  console.log("Done!");
}

if (require.main === module) {
  // construct the password.  It's the combination of your SFDC login password
  // and your security token.
  // the security token can be found at https://success.salesforce.com/answers?id=90630000000glADAAY
  const pass = `${process.env['SALESFORCE_PW']}${process.env['SALESFORCE_SECURITY_TOKEN']}`;
  const email = process.env['SALESFORCE_EMAIL'];

  // create the salesforce connection object and login
  const conn = new jsforce.Connection({});

  conn.login(
    email,
    pass,
    async function (err, userInfo) {
      if (err) {
        throw err;
      }

      console.log("Successfully logged in: ", userInfo);
      try {
        await run(conn, config.base_id, config.sfdc_to_airtable);
      } catch (err) {
        console.log(err);
      }
    }
  );
}