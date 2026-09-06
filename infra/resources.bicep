@description('Azure region for all resources')
param location string

@description('Tags applied to all resources')
param tags object

@description('Unique token (derived from environment name) used to build globally-unique resource names')
param resourceToken string

@secure()
param postgresAdminPassword string

@secure()
param paymentWebhookSecret string

@secure()
param deliveryWebhookSecret string

@secure()
param authTokenSecret string

@description('Region for the Azure OpenAI resource. Defaults to the main location, but can be overridden if gpt-4o-mini is unavailable there.')
param openAiLocation string = location

var postgresAdminLogin = 'luggyadmin'
var postgresDatabaseName = 'luggy'
var apiAppName = 'ca-api-${resourceToken}'
var webAppName = 'ca-web-${resourceToken}'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2025-07-01' = {
  name: 'log-${resourceToken}'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2025-07-01' = {
  name: 'cae-${resourceToken}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  name: 'acr${resourceToken}'
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

// Shared by both Container Apps to pull images from the registry (no
// registry password stored anywhere).
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${resourceToken}'
  location: location
  tags: tags
}

resource acrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(containerRegistry.id, identity.id, 'AcrPull')
  scope: containerRegistry
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}

// Backs the intake/inspection photo upload flow (storage.service.ts). Blobs
// are publicly readable because the app returns plain https blob URLs (no
// read SAS) to display photos.
resource storage 'Microsoft.Storage/storageAccounts@2025-06-01' = {
  name: 'st${resourceToken}'
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: true
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-06-01' = {
  parent: storage
  name: 'default'
}

resource intakeContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-06-01' = {
  parent: blobService
  name: 'intake-photos'
  properties: {
    publicAccess: 'Blob'
  }
}

resource inspectionContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-06-01' = {
  parent: blobService
  name: 'inspection-photos'
  properties: {
    publicAccess: 'Blob'
  }
}

var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

// Powers the '동네 직거래' AI carrier-registration features (ai.service.ts):
// photo -> brand/model/size/condition guess, and the conversational
// registration chatbot. Vision-capable chat deployment.
resource openAi 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: 'aoai-${resourceToken}'
  location: openAiLocation
  tags: tags
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: 'aoai-${resourceToken}'
    publicNetworkAccess: 'Enabled'
  }
}

resource openAiDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: openAi
  name: 'gpt-4o-mini'
  sku: {
    name: 'GlobalStandard'
    capacity: 10
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4o-mini'
      version: '2024-07-18'
    }
  }
}

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = {
  name: 'pg-${resourceToken}'
  location: location
  tags: tags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    storage: {
      storageSizeGB: 32
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
  }
}

resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = {
  parent: postgresServer
  name: postgresDatabaseName
}

// Container Apps egress IPs aren't static without VNet integration, so allow
// the general Azure service range (matches the portal's "Allow public access
// from any Azure service" checkbox). Good enough for MVP; VNet + private
// endpoint is a documented follow-up hardening item.
resource postgresAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2025-08-01' = {
  parent: postgresServer
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

var databaseUrl = 'postgresql://${postgresAdminLogin}:${postgresAdminPassword}@${postgresServer.properties.fullyQualifiedDomainName}:5432/${postgresDatabaseName}?sslmode=require'

// Computed from the environment's default domain (not read back from the
// container apps themselves) so both apps can reference each other's URL
// without a circular resource dependency.
var apiFqdn = '${apiAppName}.${containerAppsEnvironment.properties.defaultDomain}'
var webFqdn = '${webAppName}.${containerAppsEnvironment.properties.defaultDomain}'

resource apiApp 'Microsoft.App/containerApps@2025-07-01' = {
  name: apiAppName
  location: location
  tags: union(tags, { 'azd-service-name': 'api' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3001
        transport: 'auto'
      }
      registries: [
        {
          server: containerRegistry.properties.loginServer
          identity: identity.id
        }
      ]
      secrets: [
        { name: 'database-url', value: databaseUrl }
        { name: 'payment-webhook-secret', value: paymentWebhookSecret }
        { name: 'delivery-webhook-secret', value: deliveryWebhookSecret }
        { name: 'storage-connection-string', value: storageConnectionString }
        { name: 'auth-token-secret', value: authTokenSecret }
        { name: 'azure-openai-api-key', value: openAi.listKeys().key1 }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          // Placeholder; `azd deploy` overwrites this with the built image on
          // first deploy.
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3001' }
            { name: 'PUBLIC_API_URL', value: 'https://${apiFqdn}' }
            { name: 'WEB_ORIGIN', value: 'https://${webFqdn}' }
            { name: 'WEB_ORIGINS', value: 'https://${webFqdn}' }
            { name: 'PAYMENT_WEBHOOK_SECRET', secretRef: 'payment-webhook-secret' }
            { name: 'DELIVERY_WEBHOOK_SECRET', secretRef: 'delivery-webhook-secret' }
            { name: 'AZURE_STORAGE_CONNECTION_STRING', secretRef: 'storage-connection-string' }
            { name: 'PLATFORM_LOGISTICS_COST_RATIO', value: '0.7' }
            { name: 'AUTH_TOKEN_SECRET', secretRef: 'auth-token-secret' }
            { name: 'AZURE_OPENAI_ENDPOINT', value: openAi.properties.endpoint }
            { name: 'AZURE_OPENAI_API_KEY', secretRef: 'azure-openai-api-key' }
            { name: 'AZURE_OPENAI_DEPLOYMENT', value: 'gpt-4o-mini' }
            { name: 'AZURE_OPENAI_API_VERSION', value: '2024-06-01' }
          ]
          probes: [
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 3001
              }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
  dependsOn: [
    acrPullRole
  ]
}

resource webApp 'Microsoft.App/containerApps@2025-07-01' = {
  name: webAppName
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
      }
      registries: [
        {
          server: containerRegistry.properties.loginServer
          identity: identity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          // Placeholder; `azd deploy` overwrites this with the built image on
          // first deploy (VITE_API_URL is baked in at that point via
          // azure.yaml's buildArgs, from SERVICE_API_URI below).
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          probes: [
            {
              type: 'Readiness'
              httpGet: {
                path: '/'
                port: 3000
              }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
  dependsOn: [
    acrPullRole
  ]
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerRegistry.properties.loginServer
output SERVICE_API_URI string = 'https://${apiFqdn}'
output SERVICE_WEB_URI string = 'https://${webFqdn}'
