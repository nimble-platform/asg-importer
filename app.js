const fetch = require("node-fetch");
const cron = require("node-cron");
const utils = require("./utils");

let SR_URL = process.env.SR_URL;
let EFS_URL = process.env.EFS_URL;
let X_API_KEY = process.env.X_API_KEY;
let CLIENT_ID = process.env.CLIENT_ID;
let CLIENT_SECRET = process.env.CLIENT_SECRET;
let PUBLIC_KEY = process.env.PUBLIC_KEY;
let ROOT_PREFIX = "apis";

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

        const asgResponse = await fetch(`${EFS_URL}/apisix/admin/routes`,{
            headers: {
                'X-API-KEY': X_API_KEY
            }
        });
        const asgJSON = await asgResponse.json();

        utils.createOrUpdateEcoEndpoint(asgJSON, EFS_URL, X_API_KEY);
        utils.createServiceRegistryEndpoint(SR_URL, EFS_URL, X_API_KEY);
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
                                body = {
                                    uri: `/${ROOT_PREFIX}/${prefix}${url.pathname}*`,
                                    plugins: {
                                        "proxy-rewrite": {
                                            "regex_uri": [regex, regexReplace]
                                        },
                                        "openid-connect": {
                                            "discovery": `${EFS_URL}/auth/realms/master/.well-known/openid-configuration`,
                                            "bearer_only": true,
                                            "realm": "master",
                                            // "introspection_endpoint": `${EFS_URL}/auth/realms/master/protocol/openid-connect/token/introspect`
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
    
                            if (url.protocol === "https:") {
                                body.plugins['proxy-rewrite']["scheme"] = "https"
                            }
    
                            fetch(`${EFS_URL}/apisix/admin/routes/${matchingRoute}`, {
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

cron.schedule("0 */1 * * *", function() {
    syncData(SR_URL);
});
