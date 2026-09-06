targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the azd environment; used to derive the resource group name and a unique resource token')
param environmentName string

@minLength(1)
@description('Azure region for all resources')
param location string

@secure()
@description('Administrator password for the PostgreSQL flexible server')
param postgresAdminPassword string

@secure()
@description('Shared secret required by the /webhooks/payments endpoint')
param paymentWebhookSecret string

@secure()
@description('Shared secret required by the /webhooks/delivery endpoint')
param deliveryWebhookSecret string

@secure()
@description('Server-side secret used to sign 동네 직거래 (direct-deal) auth session tokens')
param authTokenSecret string

var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = {
  'azd-env-name': environmentName
}

resource rg 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  name: 'resources'
  scope: rg
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
    postgresAdminPassword: postgresAdminPassword
    paymentWebhookSecret: paymentWebhookSecret
    deliveryWebhookSecret: deliveryWebhookSecret
    authTokenSecret: authTokenSecret
  }
}

output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.AZURE_CONTAINER_REGISTRY_ENDPOINT
output SERVICE_API_URI string = resources.outputs.SERVICE_API_URI
output SERVICE_WEB_URI string = resources.outputs.SERVICE_WEB_URI
