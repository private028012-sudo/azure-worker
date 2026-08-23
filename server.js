require("dotenv").config();
const express = require("express");
const multer = require("multer");
const { StorageManagementClient } = require("@azure/arm-storage");
const { BlobServiceClient } = require("@azure/storage-blob");
const { ClientSecretCredential } = require("@azure/identity");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const tenantId = process.env.AZURE_TENANT_ID;
const clientId = process.env.AZURE_CLIENT_ID;
const clientSecret = process.env.AZURE_CLIENT_SECRET;
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

if (!tenantId || !clientId || !clientSecret || !subscriptionId) {
  console.error("ERROR: Missing required environment variables in .env file.");
  process.exit(1);
}

const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
const storageClient = new StorageManagementClient(credential, subscriptionId);

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Azure Public Storage & Upload</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
    input, button { width: 100%; padding: 12px; margin-top: 10px; box-sizing: border-box; }
    button { cursor: pointer; font-weight: bold; background: #0078d4; color: white; border: none; }
    #status { margin-top: 20px; padding: 12px; background: #f1f1f1; word-break: break-all; }
  </style>
</head>
<body>

<h1>Public Azure Storage & Upload</h1>

<label>1. Storage Account Name (3-24 chars, lowercase/numbers)</label>
<input id="accountName" type="text" placeholder="e.g. mystorageacc99" />

<label>2. Container / Bucket Name</label>
<input id="containerName" type="text" placeholder="e.g. my-public-container" />

<label>3. Select File</label>
<input id="file" type="file" />

<button onclick="processUpload()">Create Public Storage & Upload File</button>

<div id="status">Ready.</div>

<script>
async function processUpload() {
  const accountName = document.getElementById("accountName").value.trim();
  const containerName = document.getElementById("containerName").value.trim();
  const fileInput = document.getElementById("file");
  const status = document.getElementById("status");

  if (!accountName || !containerName || !fileInput.files.length) {
    status.innerText = "Please fill in all fields and select a file.";
    return;
  }

  const formData = new FormData();
  formData.append("accountName", accountName);
  formData.append("containerName", containerName);
  formData.append("file", fileInput.files[0]);

  status.innerText = "Creating public storage account, container, and uploading file...";

  try {
    const response = await fetch("/process", { method: "POST", body: formData });
    const result = await response.json();

    if (!response.ok) throw new Error(result.error || "Process failed.");

    status.innerHTML = \`
      <b>Success!</b><br/>
      <b>Account:</b> \${result.account}<br/>
      <b>Container:</b> \${result.container}<br/>
      <b>Public File URL:</b> <a href="\${result.publicUrl}" target="_blank">\${result.publicUrl}</a>
    \`;
  } catch (error) {
    status.innerText = "Error: " + error.message;
  }
}
</script>

</body>
</html>
  `);
});

app.post("/process", upload.single("file"), async (req, res) => {
  try {
    const { accountName, containerName } = req.body;
    const resourceGroupName = process.env.AZURE_RESOURCE_GROUP;

    const cleanAccountName = accountName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const cleanContainerName = containerName.toLowerCase().replace(/[^a-z0-9-]/g, "-");

    if (!req.file) return res.status(400).json({ error: "No file provided." });

    // 1. Create Storage Account with Public Access ALLOWED
    const poller = await storageClient.storageAccounts.beginCreate(
      resourceGroupName,
      cleanAccountName,
      {
        location: "eastus",
        sku: { name: "Standard_LRS" },
        kind: "StorageV2",
        allowBlobPublicAccess: true // Enables public access at the account level
      }
    );
    await poller.pollUntilDone();

    // 2. Fetch account keys
    const keys = await storageClient.storageAccounts.listKeys(resourceGroupName, cleanAccountName);
    const connectionString = `DefaultEndpointsProtocol=https;AccountName=${cleanAccountName};AccountKey=${keys.keys[0].value};EndpointSuffix=core.windows.net`;

    // 3. Create Container with PUBLIC BLOB Access
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(cleanContainerName);
    
    // access: 'blob' allows anonymous public read access for files inside this container
    await containerClient.createIfNotExists({ access: "blob" });

    // 4. Upload File
    const blockBlobClient = containerClient.getBlockBlobClient(req.file.originalname);
    await blockBlobClient.uploadData(req.file.buffer, {
      blobHTTPHeaders: { blobContentType: req.file.mimetype || "application/octet-stream" }
    });

    const publicUrl = blockBlobClient.url;

    res.json({
      success: true,
      account: cleanAccountName,
      container: cleanContainerName,
      file: req.file.originalname,
      publicUrl: publicUrl
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => console.log("Server running on http://localhost:3000"));