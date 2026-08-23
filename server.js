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
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Azure Storage Pipeline</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
    body { background-color: #f4f7f6; color: #333; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
    .card { background: #ffffff; padding: 40px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.08); width: 100%; max-width: 500px; }
    .header { text-align: center; margin-bottom: 25px; }
    .header h1 { font-size: 24px; color: #0078d4; font-weight: 600; }
    .header p { font-size: 14px; color: #666; margin-top: 5px; }
    .form-group { margin-bottom: 18px; }
    label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #444; }
    input[type="text"], input[type="file"] { width: 100%; padding: 12px 14px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; transition: border-color 0.2s ease; outline: none; }
    input[type="text"]:focus { border-color: #0078d4; }
    input[type="file"] { background: #fafafa; cursor: pointer; }
    button { width: 100%; padding: 14px; background-color: #0078d4; color: #ffffff; border: none; border-radius: 6px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background-color 0.2s ease; margin-top: 10px; }
    button:hover { background-color: #005a9e; }
    button:disabled { background-color: #a6a6a6; cursor: not-allowed; }
    #status { margin-top: 20px; padding: 15px; border-radius: 6px; font-size: 13px; display: none; word-break: break-all; line-height: 1.5; }
    .status-loading { background-color: #e5f3ff; color: #004578; border: 1px solid #c7e0f4; display: block !important; }
    .status-success { background-color: #dff6dd; color: #107c41; border: 1px solid #107c41; display: block !important; }
    .status-error { background-color: #fde7e9; color: #a80000; border: 1px solid #a80000; display: block !important; }
    .status-success a { color: #107c41; font-weight: bold; }
  </style>
</head>
<body>

<div class="card">
  <div class="header">
    <h1>Azure Storage Deployer</h1>
    <p>Create public infrastructure & upload files in one click</p>
  </div>

  <div class="form-group">
    <label for="accountName">Storage Account Name</label>
    <input id="accountName" type="text" placeholder="e.g. mystorageacc99" />
  </div>

  <div class="form-group">
    <label for="containerName">Container Name</label>
    <input id="containerName" type="text" placeholder="e.g. my-public-container" />
  </div>

  <div class="form-group">
    <label for="file">Select File</label>
    <input id="file" type="file" />
  </div>

  <button id="submitBtn" onclick="processUpload()">Deploy & Upload File</button>

  <div id="status"></div>
</div>

<script>
async function processUpload() {
  const accountInput = document.getElementById("accountName");
  const containerInput = document.getElementById("containerName");
  const fileInput = document.getElementById("file");
  const status = document.getElementById("status");
  const submitBtn = document.getElementById("submitBtn");

  const accountName = accountInput.value.trim();
  const containerName = containerInput.value.trim();

  if (!accountName || !containerName || !fileInput.files.length) {
    status.className = "status-error";
    status.innerText = "Please fill in all input fields and select a file.";
    return;
  }

  const formData = new FormData();
  formData.append("accountName", accountName);
  formData.append("containerName", containerName);
  formData.append("file", fileInput.files[0]);

  // UI Loading State
  submitBtn.disabled = true;
  submitBtn.innerText = "Deploying & Uploading...";
  status.className = "status-loading";
  status.innerText = "Provisioning Azure Storage, configuring public access, and uploading file (1-2 mins)...";

  try {
    const response = await fetch("/process", { method: "POST", body: formData });
    const result = await response.json();

    if (!response.ok) throw new Error(result.error || "Process failed.");

    // Display Success Card
    status.className = "status-success";
    status.innerHTML = `
      <b> deployment & Upload Successful!</b><br/><br/>
      <b>Account:</b> \${result.account}<br/>
      <b>Container:</b> \${result.container}<br/>
      <b>Public URL:</b> <a href="\${result.publicUrl}" target="_blank">View File</a>
    `;

    // Clear Form Inputs Automatically
    accountInput.value = "";
    containerInput.value = "";
    fileInput.value = "";

  } catch (error) {
    status.className = "status-error";
    status.innerText = "Error: " + error.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = "Deploy & Upload File";
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

    // 1. Create Public Storage Account
    const poller = await storageClient.storageAccounts.beginCreate(
      resourceGroupName,
      cleanAccountName,
      {
        location: "eastus",
        sku: { name: "Standard_LRS" },
        kind: "StorageV2",
        allowBlobPublicAccess: true
      }
    );
    await poller.pollUntilDone();

    // 2. Fetch Keys
    const keys = await storageClient.storageAccounts.listKeys(resourceGroupName, cleanAccountName);
    const connectionString = `DefaultEndpointsProtocol=https;AccountName=${cleanAccountName};AccountKey=${keys.keys[0].value};EndpointSuffix=core.windows.net`;

    // 3. Create Container with Anonymous Read Access
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(cleanContainerName);
    await containerClient.createIfNotExists({ access: "blob" });

    // 4. Upload File
    const blockBlobClient = containerClient.getBlockBlobClient(req.file.originalname);
    await blockBlobClient.uploadData(req.file.buffer, {
      blobHTTPHeaders: { blobContentType: req.file.mimetype || "application/octet-stream" }
    });

    res.json({
      success: true,
      account: cleanAccountName,
      container: cleanContainerName,
      file: req.file.originalname,
      publicUrl: blockBlobClient.url
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));