const axios = require('axios');
const nodemailer = require('nodemailer');

// Replace these with your own values
const organization = 'berkealpertugrul'; // Your Azure DevOps organization name
const project = 'SupportResolvedConfirmation'; // Your Azure DevOps project name
const personalAccessToken = 'dle4tcdy4ovf6xwezhsn73yeu2pazh2fbj6dirzqj2sylwkglp6a'; // Your Azure DevOps PAT

// Create an instance of axios with the base URL and authentication headers for WIQL queries
const wiqlInstance = axios.create({
    baseURL: `https://dev.azure.com/${organization}/${project}/_apis/wit/wiql?api-version=6.0`,
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(':' + personalAccessToken).toString('base64')}`
    }
});

// Define your WIQL query
const wiqlQuery = `
SELECT [System.Id]
FROM WorkItems
WHERE [System.State] = 'In Progress'
`;

// Function to fetch work item IDs using WIQL
async function fetchWorkItemIds() {
    try {
        const response = await wiqlInstance.post('', { query: wiqlQuery });
        const workItemIds = response.data.workItems.map(item => item.id);
        console.log('Fetched Work Item IDs:', workItemIds);
        return workItemIds;
    } catch (error) {
        console.error('Error fetching work item IDs:', error.response ? error.response.data : error.message);
        return [];
    }
}

// Create an instance of axios for work item updates
const workItemInstance = axios.create({
    baseURL: `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems`,
    headers: {
        'Content-Type': 'application/json-patch+json',
        'Authorization': `Basic ${Buffer.from(':' + personalAccessToken).toString('base64')}`
    }
});

// Define the update payload to change the state
const updatePayload = [
    {
        op: 'add',
        path: '/fields/System.State',
        value: 'Resolved' // New state
    }
];

// Function to update the state of work items
async function updateWorkItemState(workItemId) {
    try {
        const response = await workItemInstance.patch(`/${workItemId}?api-version=6.0`, updatePayload);
        console.log(`Work Item ${workItemId} Updated Successfully:`, response.data);
    } catch (error) {
        console.error(`Error updating work item ${workItemId} state:`, error.response ? error.response.data : error.message);
    }
}

// Fetch work item IDs and update their states
fetchWorkItemIds().then(workItemIds => {
    if (workItemIds.length > 0) {
        workItemIds.forEach(workItemId => updateWorkItemState(workItemId));
    }
});


//cd C:\Users\support\source\repos\NodeJSConsole\NodeJSConsole