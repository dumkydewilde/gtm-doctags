const { google } = require('googleapis');
const { Storage } = require('@google-cloud/storage');

const storage = new Storage();

// Storing the latest version info
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || "gtm-doctags";
const ACCOUNT_ID = process.env.ACCOUNT_ID;
const CONTAINER_ID = process.env.CONTAINER_ID;

const CONTAINER_PATH = `accounts/${ACCOUNT_ID}/containers/${CONTAINER_ID}`;

const getTriggerList = (containerVersion, workspaces) => {
    const folderNames = containerVersion.folder.reduce((agg, cur) => {
        agg[cur.folderId] = cur.name;
        return agg
    }, {})

    return containerVersion.trigger.map(t => {
        const firingTags = containerVersion.tag.filter(v => {
        if (Object.keys(v).indexOf("firingTriggerId") > -1) {
            return v.firingTriggerId.indexOf(t.triggerId) > -1
        } else {
            return false
        }
        
        });

        const filterInfo = (t) => {
        if(Object.keys(t).indexOf('filter') > -1) {
            return t.filter.map(f => {
            return `${f.parameter[0].value} [${f.type.toUpperCase()}] ${f.parameter[1].value}`
            }).join(",\n")
        } else if (Object.keys(t).indexOf('customEventFilter') > -1) {
            return t.customEventFilter.map(f => {
            return `${f.parameter[0].value} [${f.type.toUpperCase()}] ${f.parameter[1].value}`
            }).join(",\n")
        } else if (Object.keys(t).indexOf('autoEventFilter') > -1) {
            return t.autoEventFilter.map(f => {
            return `${f.parameter[0].value} [${f.type.toUpperCase()}] ${f.parameter[1].value}`
            }).join(",\n")
        } else {
            return ""
        }
        }

        const firingTagsPrettyList = firingTags.map(tag => {
        return `- [(${tag.tagId}) ${tag.name}](tag/?id=tag-${tag.tagId})`
        }).join(",\n");

        const triggerIdLink = `https://tagmanager.google.com/#/container/${CONTAINER_PATH}/workspaces/${workspaces.workspace[0].workspaceId}/triggers/${t.triggerId}`;
        
        return {
            "id": t.triggerId, 
            "name": t.name, 
            "type": t.type, 
            "link": triggerIdLink, 
            "notes": t.notes ? t.notes : "", 
            "folder": t.parentFolderId ? `<span class="folder">${folderNames[t.parentFolderId]}</span>` : "",
            "filters": filterInfo(t), 
            "tags": firingTagsPrettyList
        }
    });
}

const getTagList = (containerVersion, workspaces) => {
    const folderNames = containerVersion.folder.reduce((agg, cur) => {
        agg[cur.folderId] = cur.name;
        return agg
    }, {})

    const triggerNames = containerVersion.trigger.reduce((agg, cur) => {
        agg[cur.triggerId] = cur.name;
        return agg
    }, {})

    return containerVersion.tag.map(t => {
        let triggersPrettyList = t.firingTriggerId.map(triggerId => {
            return `- [(${triggerId}) ${triggerNames[triggerId]}](trigger/?id=trigger-${triggerId})`
        }).join("\n");
        if(t.blockingTriggerId) {
            triggersPrettyList = triggersPrettyList + "\n\nBLOCKING TRIGGERS\n\n" +
            t.blockingTriggerId.map(triggerId => {
                return `- (${triggerId}) ${triggerNames[triggerId]}`
            }).join("\n");
        }

        let htmlContent = t.parameter ? t.parameter.filter((p) => p.key.indexOf("html") > -1) : [];
        if(htmlContent.length > 0) {
            htmlContent = htmlContent[0].value;
        }

        const tagIdLink = `https://tagmanager.google.com/#/container/${CONTAINER_PATH}/workspaces/${workspaces.workspace[0].workspaceId}/tags/${t.tagId}`;
        
        return {
            "id": t.tagId, 
            "name": t.name, 
            "type": t.type, 
            "link": tagIdLink, 
            "notes": t.notes ? t.notes : "", 
            "folder": t.parentFolderId ? `<span class="folder">${folderNames[t.parentFolderId]}</span>` : "",
            "triggers": triggersPrettyList,
            "content": htmlContent || "",
            "paused": t.paused
        }
    });
}

const getVariableList = (containerVersion, workspaces) => {
    const folderNames = containerVersion.folder.reduce((agg, cur) => {
        agg[cur.folderId] = cur.name;
        return agg
    }, {})

    return containerVersion.variable.map(v => {
        let variableValue = "";
        if (v.type === "jsm") {
            variableValue = v.parameter.filter((p) => p.key.indexOf('javascript') > -1)[0].value
        } else {
            try {
                variableValue = v.parameter.map(p => {
                    if (p.key === "value" || p.key === "defaultValue" || p.key === "name") { return p.value }
                    }).filter((p) => p !== undefined)[0]
            } catch(e) {}
        }

        const variableIdLink = `https://tagmanager.google.com/#/container/${CONTAINER_PATH}/workspaces/${workspaces.workspace[0].workspaceId}/variables/${v.variableId}`;
        
        return {
            "id": v.variableId, 
            "name": v.name, 
            "type": v.type, 
            "link": variableIdLink, 
            "notes": v.notes ? v.notes : "", 
            "folder": v.parentFolderId ? `<span class="folder">${folderNames[v.parentFolderId]}</span>` : "",
            "content": variableValue
        }
    });
}

const getVersionsListMarkdown = (versionHeaders) => {
    const tableHeader = "## Versions\n\n" +
                        "| Version ID | name                      | Tags | Triggers | Variables | CustomTemplates | Zones |\n" +
                        "|------------|---------------------------|------|----------|-----------|-----------------|-------|\n";

    return tableHeader + versionHeaders.map(v => {
        return `|[${v.containerVersionId}](https://tagmanager.google.com/#/versions/accounts/${ACCOUNT_ID}/containers/${CONTAINER_ID}/versions/${v.containerVersionId})` + 
            `|${v.name}|${v.numTags}|${v.numTriggers}|${v.numVariables}|${v.numCustomTemplates}|${v.numZones}|`
    }).join("\n")
}

exports.containerToMarkDown = async(event, context) => {
    try {
        // Set up authentication (don't forget to add your service account to the GTM container)
        const auth = new google.auth.GoogleAuth({
            scopes: ["https://www.googleapis.com/auth/tagmanager.readonly"]
        });
        const authClient = await auth.getClient();

        const tagmanager = google.tagmanager({
            version: 'v2',
            auth: authClient
        });

        // Get container details
        const containerVersionInfo = await tagmanager.accounts.containers.versions.live({
                parent: CONTAINER_PATH
            });

        // Get Workspaces (for linking to edit)
        const workspaces = await tagmanager.accounts.containers.workspaces.list({
            parent: CONTAINER_PATH
        });

        /* This is where things get ugly because I don't have a good template (engine) for creating markdown 
        files yet. So, content and style get very conflated here...
        */

        // Create MD file for triggers and save to storage
        const triggerList = getTriggerList(containerVersionInfo.data, workspaces.data);
        const triggerMD = triggerList.map(t => {
            return `\n## ${t.name} :id=trigger-${t.id}
\n*<span class="trigger-type ${t.type}">${t.type}</span>* ${t.folder}<span class="edit trigger link"><a href="${t.link}">edit trigger</a></span>
\n${t.notes}\n` +
(t.filters != "" ? ("\n\n#### Filters\n`" + t.filters + "`") : "")
+ `\n\n#### Tags with this trigger \n${t.tags}\n`
        }).join("")

        await storage.bucket(STORAGE_BUCKET).file('trigger/README.md').save(triggerMD, (err) => {
            (err && console.error(err)) || console.log('succesfully uploaded trigger file');
        });


        // Create MD file for tags and save to storage
        const tagList = getTagList(containerVersionInfo.data, workspaces.data);
        const tagMD = tagList.map(t => {
            return `\n## ${t.name}`+ (t.paused == true ? " <span class='paused'>paused</span>" : "") +` :id=tag-${t.id}
\n*<span class="tag-type ${t.type}">${t.type}</span>* ${t.folder} <span class="edit tag link"><a href="${t.link}">edit tag</a></span>
\n${t.notes}\n` +
(t.content.length > 0 ? ("#### HTML Content\n\n```html\n" + t.content + "\n```\n") : "")
+ `\n#### Triggers
\n${t.triggers}\n`
        }).join("")
        
        await storage.bucket(STORAGE_BUCKET).file('tag/README.md').save(tagMD, (err) => {
            (err && console.error(err)) || console.log('succesfully uploaded tags file');
        });

     // Create MD file for variables and save to storage
     const variableList = getVariableList(containerVersionInfo.data, workspaces.data);
     const variableMD = variableList.map(t => {
        return `\n## ${t.name} :id=variable-${t.id}` + 
            `\n*<span class="variable-type ${t.type}">${t.type}</span>* ${t.folder} <span class="edit variable link"><a href="${t.link}">edit variable</a></span>` +
            `\n${t.notes}\n` +
            (t.type === "jsm" ? ("#### JS Content\n\n```javascript\n" + t.content + "\n```\n") : "") +
            (t.type !== "jsm" && t.content !== undefined ? ("#### Value\n`" + t.content + "`\n") : "")
        }).join("")
     
     await storage.bucket(STORAGE_BUCKET).file('variable/README.md').save(variableMD, (err) => {
         (err && console.error(err)) || console.log('succesfully uploaded variables file');
     });


     // Create file with versions table
     const versionHeaders = await tagmanager.accounts.containers.version_headers.list({
         parent: CONTAINER_PATH
     })
    const versionsListMD = getVersionsListMarkdown(versionHeaders.data.containerVersionHeader);        
    await storage.bucket(STORAGE_BUCKET).file('versions.md').save(versionsListMD, (err) => {
        (err && console.error(err)) || console.log('succesfully uploaded versions file');
    });

    } catch(e) {
        console.error(e);
    }
}