const fetch = require("node-fetch");
const cron = require("node-cron");
const utils = require("./utils");

let SR_URL = process.env.SR_URL;        // Base URL of the Service Registry (LinkSmart Service Catalog)
let EFS_KEYCLOAK_URL = process.env.EFS_KEYCLOAK_URL;        // Base URL of the EFS Keycloak
let EFS_KEYCLOAK_REALM = process.env.EFS_KEYCLOAK_REALM;        // Name of the realm
let ASG_URL = process.env.ASG_URL;      // Base URL of the API Security Gateway (Apache APISIX)
let X_API_KEY = process.env.X_API_KEY;      // x-api-key for accessing APISIX's API
let CLIENT_ID = process.env.CLIENT_ID;
let CLIENT_SECRET = process.env.CLIENT_SECRET;
let PUBLIC_KEY = process.env.PUBLIC_KEY;    // Public key of the EFS Keycloak
let ROOT_PREFIX = "apis";
let SR_URL_CONTEXT_PATH = process.env.SR_URL_CONTEXT_PATH || "";
let CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 */1 * * *";     // default: hourly

let currentIncrement = 10;
var availableRoutes = [];

function nextSlot(current, direction) {
    let inc = direction === 'down' ? -1 : 1;
    let next = current;

    while (availableRoutes.indexOf(next += inc) > -1) ;
    return next;
}

function fillAvailableRoutes(asrJSON){
    let nodes = asrJSON['node']['nodes'];
    if (nodes !== undefined && nodes.length !== 0) {
        for (let i = 0; i < nodes.length; i++) {
            let key = nodes[i].key;
            let routeID = key.substring(key.lastIndexOf("/") + 1, key.length);
            availableRoutes.push(Number(routeID));
        }
    }
}


const syncData = async SR_URL => {
    try {
        const srResponse = await fetch(SR_URL);
        const srJSON = await srResponse.json();

        const asgResponse = await fetch(`${ASG_URL}/apisix/admin/routes`,{
            headers: {
                'X-API-KEY': X_API_KEY
            }
        });
        const asgJSON = await asgResponse.json();

        utils.createOrUpdateEcoEndpoint(asgJSON, ASG_URL, X_API_KEY);
        utils.createServiceRegistryEndpoint(SR_URL, EFS_KEYCLOAK_URL, EFS_KEYCLOAK_REALM, ASG_URL, X_API_KEY, SR_URL_CONTEXT_PATH);
        fillAvailableRoutes(asgJSON);
        // iterate through all the requests
        let services = srJSON.services;

        if (services !== undefined) {
            console.log("no.of services: " + services.length);
            for (let i = 0; i < services.length; i++) {
                let rootService = services[i];
                console.log("iterating service : " + rootService.id);
                console.log("no.of apis in service: " + rootService.apis.length);

                for (let j = 0; j < rootService.apis.length; j++) {

                    try{
                        //meta.dataspine.createSecureProxy 
                        let api = rootService.apis[j];
                        console.log("the api : " + api.id + " : " + api.protocol + " : " + api.url + " meta: " );

                        let meta = api.meta;
                        console.log(meta);
                        let url = null;
                        if(api.url != undefined && !api.url==""){
                            url = new URL(api.url);
                        }                        
                        
                            let host = url.hostname;
                            let port = url.port;
                            if(port === undefined || port === ""){
                                if (url.protocol === "http:") {
                                    port = 80
                                }else {
                                    port = 443
                                }
                            }
                            let hostPort = `${host}:${port}`;
    
                            let prefix = rootService.id + "/" + rootService.apis[j].id;
                            let matchingRoute = utils.getMatchingRoute(asgJSON, hostPort, prefix, url.pathname, ROOT_PREFIX);
    
                            if (matchingRoute === null) {
                                matchingRoute = nextSlot(currentIncrement);
                                currentIncrement += 5;
                            }
    
                            let regexReplace = `${url.pathname}$1`;
                            if (url.pathname === undefined || url.pathname === "") {
                                regexReplace = `/$1`;
                            }
    
                            let regex = `^/${ROOT_PREFIX}/${prefix}${url.pathname}(.*)`;
                            let body = "";
                            //let bodyRoute2 = "";

                            if(meta.dataspine != null && meta.dataspine.createSecureProxy !=null && meta.dataspine.createSecureProxy == false) {
                                console.log("creating an unsecured proxy...");
                                body = {
                                    uri: `/${ROOT_PREFIX}/${prefix}${url.pathname}*`,
                                    plugins: {
                                        "proxy-rewrite": {
                                            "regex_uri": [regex, regexReplace]
                                        }
                                    },
                                    upstream: {
                                        "type": "roundrobin",
                                        "nodes": {
                                            [hostPort]: 1
                                        }
                                    }
                                };
                            } else {
                                //creating a secured proxy
                                console.log("creating a secured proxy...");

                                if(meta.dataspine != null && meta.dataspine.enableAuthZ !=null && meta.dataspine.enableAuthZ == true) {
                                    // Currently only two authorization/access-levels are supported: (1) either a user has full, admin-level access (CRUD) to the API or (2) no access at all
                                    // Three different access-levels can be supported easily in the future: (1) no access (2) view access (3) full, admin-level (CRUD) access
                                    /*route1body = {
                                        methods: ["GET", "OPTIONS"],
                                        uri: `/${ROOT_PREFIX}/${prefix}${url.pathname}*`,
                                        plugins: {
                                            "proxy-rewrite": {
                                                "regex_uri": [regex, regexReplace]
                                            },
                                            "authz-keycloak": {
                                                "token_endpoint": `${EFS_KEYCLOAK_URL}/auth/realms/${EFS_KEYCLOAK_REALM}/protocol/openid-connect/token`,
                                                "permissions": [rootService.id + "#" + rootService.apis[j].id + "_view"],    // "<resource_name>#<scope_name>"
                                                "audience": "apisix",
                                                "ssl_verify": false
                                            }
                                        },
                                        upstream: {
                                            "type": "roundrobin",
                                            "nodes": {
                                                [hostPort]: 1
                                            }
                                        }
                                    };*/
                                    // route2body
                                    body = {
                                        methods: ["POST", "PUT", "PATCH", "DELETE", "GET", "OPTIONS"],
                                        uri: `/${ROOT_PREFIX}/${prefix}${url.pathname}*`,
                                        plugins: {
                                            "proxy-rewrite": {
                                                "regex_uri": [regex, regexReplace]
                                            },
                                            "authz-keycloak": {
                                                "token_endpoint": `${EFS_KEYCLOAK_URL}/auth/realms/${EFS_KEYCLOAK_REALM}/protocol/openid-connect/token`,
                                                "permissions": [rootService.id + "#" + rootService.apis[j].id + "_admin"],    // "<resource_name>#<scope_name>"
                                                "audience": "apisix",
                                                "ssl_verify": false
                                            }
                                        },
                                        upstream: {
                                            "type": "roundrobin",
                                            "nodes": {
                                                [hostPort]: 1
                                            }
                                        }
                                    };
                                }
                                else {
                                    body = {
                                        uri: `/${ROOT_PREFIX}/${prefix}${url.pathname}*`,
                                        plugins: {
                                            "proxy-rewrite": {
                                                "regex_uri": [regex, regexReplace]
                                            },
                                            "openid-connect": {
                                                "discovery": `${EFS_KEYCLOAK_URL}/auth/realms/${EFS_KEYCLOAK_REALM}/.well-known/openid-configuration`,
                                                "bearer_only": true,
                                                "realm": `${EFS_KEYCLOAK_REALM}`,
                                                // "introspection_endpoint": `${EFS_KEYCLOAK_URL}/auth/realms/${EFS_KEYCLOAK_REALM}/protocol/openid-connect/token/introspect`
                                                "token_signing_alg_values_expected": "RS256",
                                                "client_id":"testClient",
                                                "client_secret":"testSecret",
                                                "public_key": PUBLIC_KEY
                                            }
                                        },
                                        upstream: {
                                            "type": "roundrobin",
                                            "nodes": {
                                                [hostPort]: 1
                                            }
                                        }
                                    };
                                }

                            }

                            if (url.protocol === "https:") {
                                body.plugins['proxy-rewrite']["scheme"] = "https"
                            }

                            fetch(`${ASG_URL}/apisix/admin/routes/${matchingRoute}`, {
                                method: 'PUT',
                                body: JSON.stringify(body),
                                headers: {
                                    'Content-Type': 'application/json',
                                    'X-API-KEY': X_API_KEY
                                },
                            })
                                .then(res => {
                                    return res.json()
                                })
                                .then(json => {
                                    console.log(`route_create request ${JSON.stringify(json)}`)
                                })
                                .catch((err) => {
                                    console.log(`error occurred while creating the route: ${JSON.stringify(err)}`)
                                })

                    }catch (e) {
                        console.log(`error when parsing the routes: ${JSON.stringify(e)}`)
                    }
                }
            }
        }
    } catch (error) {
        console.log(error);
    }
};

syncData(SR_URL);

cron.schedule(CRON_SCHEDULE, function() {
    syncData(SR_URL);
});
