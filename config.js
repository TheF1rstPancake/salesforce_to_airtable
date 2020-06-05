// the ID of the base where this data should end up
// this script uses our Sales CRM template which can be found at
//    https://airtable.com/templates/sales-and-customers/expvjTzYAZareV1pt/sales-crm
const base_id = 'app06ngW3xR9R2X59';

/** This object controls how we pull data from SFDC
 * Each key is the name of an SFDC object and they point to another object that defines how to pull data from SFDC
 *  @param {string} table                         the Airtable table where this object's data should go
 *  @param {string} primaryAirtableFieldName      the primary field name in the Airtable table
 *  @param {string} primarySalesforceFieldName    the unique identifier for this Salesforce object (generally will be Id, but you can use another identifier if you choose)
 *  @param {Object} fields                        a map where each key is a field in Salesforce and the value is the corresponding field name in the Airtable table
 *  @param {string} [whereClause]                 valid SOQL WHERE clause which limits the objects to fetch. DO NOT include "WHERE" as a part of this
 *  @param {string} [returnValue]                 after parsing/uploading these records into Airtable, this is the object's field that should be returned so that the next object can use those values to filter its selection
 *  @param {string} [filterFieldName]             if using the returnValue, this is the field name in the current object that holds those returnValues values.  For example, you likely want to limit your opportunities to the AccountIDs returned after fetching Account objects.  In that case, on the Opportunity object, this would be "AccountId"
 */

const sfdc_to_at = {
  'Opportunity': {
    table: 'Opportunities',
    primaryAirtableFieldName: 'SFDC ID',
    primarySalesforceFieldName: 'Id',
    //filterFieldName: 'AccountId',
    whereClause: "StageName IN ('Interested') AND CreatedDate = LAST_90_DAYS",
    returnValue: 'AccountId',
    fields: {
      OwnerId: 'Owner',
      Id: 'SFDC ID',
      AccountId: 'Account',
      Name: 'Opportunity name',
      StageName: 'Status',
      CreatedDate: "Created Date",
      Amount: 'Estimated value',
      CloseDate: 'Expected close date'
    }
  },

  'Account': {
    table: 'Accounts',
    primaryAirtableFieldName: 'SFDC ID',
    primarySalesforceFieldName: 'Id',
    returnValue: 'Id',
    filterFieldName: 'Id',
    fields: {
      Id: 'SFDC ID',
      Name: 'Name',
      OwnerId: 'Owner',
      BillingAddress: 'HQ address',
      Website: 'Company website',
      Industry: 'Industry'
    },

  },
  'Contact': {
    table: 'Contacts',
    primaryAirtableFieldName: 'SFDC ID',
    primarySalesforceFieldName: 'Id',
    filterFieldName: 'AccountId',
    fields: {
      Id: 'SFDC ID',
      AccountId: 'Account',
      Email: 'Email',
      Name: 'Name',
      Phone: 'Phone'
    }
  },
  'User': {
    table: 'Users',
    primaryAirtableFieldName: 'SFDC ID',
    primarySalesforceFieldName: 'Id',
    fields: {
      Id: 'SFDC ID',
      Email: 'Email',
      Name: 'Name',
      Title: 'Title'
    }
  }
}

module.exports = {
  sfdc_to_airtable: sfdc_to_at,
  base_id: base_id
}