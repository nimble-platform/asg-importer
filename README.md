# asg-importer

### Overview
- The asg-importer reads the Data Spine Service Registry ([LinkSmart Service Catalog](https://github.com/linksmart/service-catalog)) periodically and creates proxy endpoints/routes in the API Security Gateway ([Apache APISIX](https://github.com/apache/apisix)) for the APIs registered in the Service Registry. 
- In addition, the asg-importer, on start-up, creates proxy routes for the Service Registry in API Security Gateway to secure the Service Registry's API using the policies defined in the EFPF Security Portal (EFS) Keycloak.

### Configuration: Environment variables (ENVs)
- SR_URL: Base URL of the Service Registry (SR). The URL that returns SR's index page which contains all the registered services. E.g., `http://www.example.com/services`.
- EFS_KEYCLOAK_URL: Base URL of the EFS Keycloak. E.g., If the EFS Keycloak's OpenId Connect discovery URL is `http://www.example.com/auth/realms/master/.well-known/openid-configuration`, the EFS_KEYCLOAK_URL would be `http://www.example.com`.
- ASG_URL: Base URL of the API Security Gateway (ASG). E.g., If the ASG returns its routes on calling `http://www.example.com/apisix/admin/routes`, the ASG_URL would be `http://www.example.com`.
- X_API_KEY: x-api-key for accessing ASG's API
- CLIENT_ID: CLIENT_ID for the APISIX client in the EFS Keycloak
- CLIENT_SECRET: CLIENT_SECRET for the APISIX client in the EFS Keycloak
- PUBLIC_KEY: Public key of the EFS Keycloak
- SR_URL_CONTEXT_PATH: Context/base path of the Service Registry (SR) URL. E.g., if the SR returns its index page on calling `http://www.example.com/services`, the SR_URL_CONTEXT_PATH would be `services`.
- CRON_SCHEDULE: cron schedule expression for running the asg-importer periodically. The default value is `0 */1 * * *` i.e., hourly.

### Run
##### As a node.js app:
```
git clone https://github.com/nimble-platform/asg-importer
cd asg-importer
npm install
ENV1=value1 ENV2=value2 node app.js
```

##### As a Docker container
- Clone

as above

- Build

`docker build -t ds/asg-importer .`

- Run

Using the docker-compose available in the root directory of asg-importer: 
Configure the environment variables, update the image name/tag if needed and run:

`docker compose up -d`

Or

Using docker run:

`docker run -d --name asg-importer -e ENV1='value1' -e ENV2='value2' ds/asg-importer:latest`