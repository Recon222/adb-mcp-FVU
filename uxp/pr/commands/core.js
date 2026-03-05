
const fs = require("uxp").storage.localFileSystem;
const app = require("premierepro");
const constants = require("premierepro").Constants;

const {BLEND_MODES, TRACK_TYPE, METADATA_TYPE } = require("./consts.js")

const {
    _getSequenceFromId,
    _setActiveSequence,
    setParam,
    getParam,
    addEffect,
    findProjectItem,
    execute,
    getTrack,
    getTrackItems,
    getProjectContentInfo
} = require("./utils.js")

const saveProject = async (command) => {
    let project = await app.Project.getActiveProject()

    project.save()
}

const saveProjectAs = async (command) => {
    let project = await app.Project.getActiveProject()

    const options = command.options;
    const filePath = options.filePath;

    project.saveAs(filePath)
}

const openProject = async (command) => {

    const options = command.options;
    const filePath = options.filePath;

    await app.Project.open(filePath);    
}


const importMedia = async (command) => {

    let options = command.options
    let paths = command.options.filePaths

    let project = await app.Project.getActiveProject()

    let root = await project.getRootItem()
    let originalItems = await root.getItems()

    //import everything into root
    let rootFolderItems = await project.getRootItem()


    let success = await project.importFiles(paths, true, rootFolderItems)
    //TODO: what is not success?

    let updatedItems = await root.getItems()
    
    const addedItems = updatedItems.filter(
        updatedItem => !originalItems.some(originalItem => originalItem.name === updatedItem.name)
      );
      
    let addedProjectItems = [];
    for (const p of addedItems) { 
        addedProjectItems.push({ name: p.name });
    }
    
    return { addedProjectItems };
}


//note: right now, we just always add to the active sequence. Need to add support
//for specifying sequence
const addMediaToSequence = async (command) => {

    let options = command.options
    let itemName = options.itemName
    let id = options.sequenceId

    let project = await app.Project.getActiveProject()
    let sequence = await _getSequenceFromId(id)

    let insertItem = await findProjectItem(itemName, project)

    let editor = await app.SequenceEditor.getEditor(sequence)
  
    const insertionTime = await app.TickTime.createWithTicks(options.insertionTimeTicks.toString());
    const videoTrackIndex = options.videoTrackIndex
    const audioTrackIndex = options.audioTrackIndex
  
    execute(() => {
        let action
        if (options.overwrite) {
            action = editor.createOverwriteItemAction(insertItem, insertionTime, videoTrackIndex, audioTrackIndex)
        } else {
            const limitShift = false
            action = editor.createInsertProjectItemAction(insertItem, insertionTime, videoTrackIndex, audioTrackIndex, limitShift)
        }
        return [action]
    }, project)
}


const setAudioTrackMute = async (command) => {

    let options = command.options
    let id = options.sequenceId

    let sequence = await _getSequenceFromId(id)

    let track = await sequence.getTrack(options.audioTrackIndex, TRACK_TYPE.AUDIO)
    track.setMute(options.mute)
}



const setVideoClipProperties = async (command) => {

    const options = command.options
    let id = options.sequenceId

    let project = await app.Project.getActiveProject()
    let sequence = await _getSequenceFromId(id)

    if(!sequence) {
        throw new Error(`setVideoClipProperties : Requires an active sequence.`)
    }

    let trackItem = await getTrack(sequence, options.videoTrackIndex, options.trackItemIndex, TRACK_TYPE.VIDEO)

    let opacityParam = await getParam(trackItem, "AE.ADBE Opacity", "Opacity")
    let opacityKeyframe = await opacityParam.createKeyframe(options.opacity)

    let blendModeParam = await getParam(trackItem, "AE.ADBE Opacity", "Blend Mode")

    let mode = BLEND_MODES[options.blendMode.toUpperCase()]
    let blendModeKeyframe = await blendModeParam.createKeyframe(mode)

    execute(() => {
        let opacityAction = opacityParam.createSetValueAction(opacityKeyframe);
        let blendModeAction = blendModeParam.createSetValueAction(blendModeKeyframe);
        return [opacityAction, blendModeAction]
    }, project)

    // /AE.ADBE Opacity
    //Opacity
    //Blend Mode

}

const appendVideoFilter = async (command) => {

    let options = command.options
    let id = options.sequenceId

    let sequence = await _getSequenceFromId(id)

    if(!sequence) {
        throw new Error(`appendVideoFilter : Requires an active sequence.`)
    }

    let trackItem = await getTrack(sequence, options.videoTrackIndex, options.trackItemIndex, TRACK_TYPE.VIDEO)

    let effectName = options.effectName
    let properties = options.properties

    let d = await addEffect(trackItem, effectName)

    for(const p of properties) {
        console.log(p.value)
        await setParam(trackItem, effectName, p.name, p.value)
    }
}


const setActiveSequence = async (command) => {
    let options = command.options
    let id = options.sequenceId

    let sequence = await _getSequenceFromId(id)

    await _setActiveSequence(sequence)
}

const createProject = async (command) => {

    let options = command.options
    let path = options.path
    let name = options.name

    if (!path.endsWith('/')) {
        path = path + '/';
    }

    //todo: this will open a dialog if directory doesnt exist
    let project = await app.Project.createProject(`${path}${name}.prproj`) 


    if(!project) {
        throw new Error("createProject : Could not create project. Check that the directory path exists and try again.")
    }

    //create a default sequence and set it as active
    //let sequence = await project.createSequence("default")
    //await project.setActiveSequence(sequence)
}


const _exportFrame = async (sequence, filePath, seconds) => {

    const fileType = filePath.split('.').pop()

    let size = await sequence.getFrameSize()

    let p = window.path.parse(filePath)
    let t = app.TickTime.createWithSeconds(seconds)

    let out = await app.Exporter.exportSequenceFrame(sequence, t, p.name, p.dir, size.width, size.height)

    let ps = `${p.dir}${window.path.sep}${p.name}`
    let outPath = `${ps}.${fileType}`

    if(!out) {
        throw new Error(`exportFrame : Could not save frame to [${outPath}]`);
    }

    return outPath
}

const exportFrame = async (command) => {
    const options = command.options;
    let id = options.sequenceId;
    let filePath = options.filePath;
    let seconds = options.seconds;

    let sequence = await _getSequenceFromId(id);

    const outPath = await _exportFrame(sequence, filePath, seconds);

    return {"filePath": outPath}
}

const setClipDisabled = async (command) => {

    const options = command.options;
    const id = options.sequenceId;
    const trackIndex = options.trackIndex;
    const trackItemIndex = options.trackItemIndex;
    const trackType = options.trackType;

    let project = await app.Project.getActiveProject()
    let sequence = await _getSequenceFromId(id)

    if(!sequence) {
        throw new Error(`setClipDisabled : Requires an active sequence.`)
    }

    let trackItem = await getTrack(sequence, trackIndex, trackItemIndex, trackType)

    execute(() => {
        let action = trackItem.createSetDisabledAction(options.disabled)
        return [action]
    }, project)

}


const appendVideoTransition = async (command) => {

    let options = command.options
    let id = options.sequenceId

    let project = await app.Project.getActiveProject()
    let sequence = await _getSequenceFromId(id)

    if(!sequence) {
        throw new Error(`appendVideoTransition : Requires an active sequence.`)
    }

    let trackItem = await getTrack(sequence, options.videoTrackIndex, options.trackItemIndex,TRACK_TYPE.VIDEO)

    let transition = await app.TransitionFactory.createVideoTransition(options.transitionName);

    let transitionOptions = new app.AddTransitionOptions()
    transitionOptions.setApplyToStart(false)

    const time = await app.TickTime.createWithSeconds(options.duration)
    transitionOptions.setDuration(time)
    transitionOptions.setTransitionAlignment(options.clipAlignment)

    execute(() => {
        let action = trackItem.createAddVideoTransitionAction(transition, transitionOptions)
        return [action]
    }, project)
}


const getProjectInfo = async (command) => {
    let project = await app.Project.getActiveProject()

    const name = project.name;
    const path = project.path;
    const id = project.guid.toString();

    const items = await getProjectContentInfo()

    return {
        name,
        path,
        id,
        items
    }
}



const createSequenceFromMedia = async (command) => {

    let options = command.options

    let itemNames = options.itemNames
    let sequenceName = options.sequenceName

    let project = await app.Project.getActiveProject()

    let found = false
    try {
        await findProjectItem(sequenceName, project)
        found  = true
    } catch {
        //do nothing
    }

    if(found) {
        throw Error(`createSequenceFromMedia : sequence name [${sequenceName}] is already in use`)
    }

    let items = []
    for (const name of itemNames) {

        //this is a little inefficient
        let insertItem = await findProjectItem(name, project)
        items.push(insertItem)
    }


    let root = await project.getRootItem()
    
    let sequence = await project.createSequenceFromMedia(sequenceName, items, root)

    await _setActiveSequence(sequence)
}

const setClipStartEndTimes = async (command) => {
    const options = command.options;

    const sequenceId = options.sequenceId;
    const trackIndex = options.trackIndex;
    const trackItemIndex = options.trackItemIndex;
    const startTimeTicks = options.startTimeTicks;
    const endTimeTicks = options.endTimeTicks;
    const trackType = options.trackType

    const sequence = await _getSequenceFromId(sequenceId)
    let trackItem = await getTrack(sequence, trackIndex, trackItemIndex, trackType)

    const startTick = await app.TickTime.createWithTicks(startTimeTicks.toString());
    const endTick = await app.TickTime.createWithTicks(endTimeTicks.toString());;

    let project = await app.Project.getActiveProject();

    execute(() => {

        let out = []

        out.push(trackItem.createSetStartAction(startTick));
        out.push(trackItem.createSetEndAction(endTick))

        return out
    }, project)
}

const closeGapsOnSequence = async(command) => {
    const options = command.options
    const sequenceId = options.sequenceId;
    const trackIndex = options.trackIndex;
    const trackType = options.trackType;

    let sequence = await _getSequenceFromId(sequenceId)

    let out = await _closeGapsOnSequence(sequence, trackIndex, trackType)
    
    return out
}

const _closeGapsOnSequence = async (sequence, trackIndex, trackType) => {
  
    let project = await app.Project.getActiveProject()

    let items = await getTrackItems(sequence, trackIndex, trackType)

    if(!items || items.length === 0) {
        return;
    }
    
    const f = async (item, targetPosition) => {
        let currentStart = await item.getStartTime()

        let a = await currentStart.ticksNumber
        let b = await targetPosition.ticksNumber
        let shiftAmount = (a - b)// How much to shift 
        
        shiftAmount *= -1;

        let shiftTick = app.TickTime.createWithTicks(shiftAmount.toString())

        return shiftTick
    }

    let targetPosition = app.TickTime.createWithTicks("0")


    for(let i = 0; i < items.length; i++) {
        let item = items[i];
        let shiftTick = await f(item, targetPosition)
        
        execute(() => {
            let out = []

                out.push(item.createMoveAction(shiftTick))

            return out
        }, project)
        
        targetPosition = await item.getEndTime()
    }
}

//TODO: change API to take trackType?

//TODO: pass in scope here
const removeItemFromSequence = async (command) => {
    const options = command.options;

    const sequenceId = options.sequenceId;
    const trackIndex = options.trackIndex;
    const trackItemIndex = options.trackItemIndex;
    const rippleDelete = options.rippleDelete;
    const trackType = options.trackType

    let project = await app.Project.getActiveProject()
    let sequence = await _getSequenceFromId(sequenceId)

    if(!sequence) {
        throw Error(`addMarkerToSequence : sequence with id [${sequenceId}] not found.`)
    }

    let item = await getTrack(sequence, trackIndex, trackItemIndex, trackType);

    let editor = await app.SequenceEditor.getEditor(sequence)

    let trackItemSelection = await sequence.getSelection();
    let items = await trackItemSelection.getTrackItems()

    for (let t of items) {
        await trackItemSelection.removeItem(t)
    }

    trackItemSelection.addItem(item, true)

    execute(() => {
        const shiftOverlapping = false
        let action = editor.createRemoveItemsAction(trackItemSelection, rippleDelete, constants.MediaType.ANY, shiftOverlapping )
        return [action]
    }, project)
}

const addMarkerToSequence = async (command) => {
    const options = command.options;
    const sequenceId = options.sequenceId;
    const markerName = options.markerName;
    const startTimeTicks = options.startTimeTicks;
    const durationTicks = options.durationTicks;
    const comments = options.comments;
    const markerType = options.markerType || "Comment";

    const sequence = await _getSequenceFromId(sequenceId)

    if(!sequence) {
        throw Error(`addMarkerToSequence : sequence with id [${sequenceId}] not found.`)
    }

    let markers = await app.Markers.getMarkers(sequence);

    let project = await app.Project.getActiveProject()

    execute(() => {

        let start = app.TickTime.createWithTicks(startTimeTicks.toString())
        let duration = app.TickTime.createWithTicks(durationTicks.toString())

        let action = markers.createAddMarkerAction(markerName, markerType, start, duration, comments)
        return [action]
    }, project)

}

const moveProjectItemsToBin = async (command) => {
    const options = command.options;
    const binName = options.binName;
    const projectItemNames = options.itemNames;

    const project = await app.Project.getActiveProject()
    
    const binFolderItem = await findProjectItem(binName, project)

    if(!binFolderItem) {
        throw Error(`moveProjectItemsToBin : Bin with name [${binName}] not found.`)
    }

    let folderItems = [];

    for(let name of projectItemNames) {
        let item = await findProjectItem(name, project)

        if(!item) {
            throw Error(`moveProjectItemsToBin : FolderItem with name [${name}] not found.`)
        }

        folderItems.push(item)
    }

    const rootFolderItem = await project.getRootItem()

    execute(() => {

        let actions = []

        for(let folderItem of folderItems) {
            let b = app.FolderItem.cast(binFolderItem)
            let action = rootFolderItem.createMoveItemAction(folderItem, b)
            actions.push(action)
        }

        return actions
    }, project)

}

const createBinInActiveProject = async (command) => {
    const options = command.options;
    const binName = options.binName;

    const project = await app.Project.getActiveProject()
    const folderItem = await project.getRootItem()

    execute(() => {
        let action = folderItem.createBinAction(binName, true)
        return [action]
    }, project)
}

const getProjectMetadata = async (command) => {
    const options = command.options;
    const itemName = options.itemName;

    const project = await app.Project.getActiveProject();
    const projectItem = await findProjectItem(itemName, project);

    // Get raw XML metadata string
    const metadataXml = await app.Metadata.getProjectMetadata(projectItem);

    // Parse XML to structured JSON using XMPMeta
    const { XMPMeta, XMPConst } = require("uxp").xmp;
    const xmp = new XMPMeta(metadataXml);

    const kPProPrivateProjectMetadataURI =
        "http://ns.adobe.com/premierePrivateProjectMetaData/1.0/";

    // Extract known project metadata fields
    const fields = {};
    const fieldNames = [
        "Column.Intrinsic.Name",
        "Column.Intrinsic.TapeName",
        "Column.Intrinsic.LogNote",
        "Column.Intrinsic.MediaStart",
        "Column.Intrinsic.MediaEnd",
        "Column.Intrinsic.MediaDuration",
        "Column.Intrinsic.VideoInfo",
        "Column.Intrinsic.AudioInfo",
        "Column.PropertyText.Description",
        "Column.PropertyText.Comment",
        "Column.PropertyText.Scene",
        "Column.PropertyText.Shot",
        "Column.PropertyBool.Good",
    ];

    for (const fieldName of fieldNames) {
        try {
            if (xmp.doesPropertyExist(kPProPrivateProjectMetadataURI, fieldName)) {
                const prop = xmp.getProperty(kPProPrivateProjectMetadataURI, fieldName);
                fields[fieldName] = prop.value;
            }
        } catch (e) {
            // Skip fields that cannot be read
        }
    }

    return {
        itemName: itemName,
        fields: fields,
        rawXml: metadataXml
    };
};


const getXMPMetadata = async (command) => {
    const options = command.options;
    const itemName = options.itemName;

    const project = await app.Project.getActiveProject();
    const projectItem = await findProjectItem(itemName, project);

    // Get raw XMP XML metadata string
    const xmpXml = await app.Metadata.getXMPMetadata(projectItem);

    // Parse XML to structured JSON using XMPMeta
    const { XMPMeta, XMPConst } = require("uxp").xmp;
    const xmp = new XMPMeta(xmpXml);

    // Extract metadata organized by namespace
    const metadata = {};

    // Dublin Core (dc:) -- title, creator, description, subject/keywords
    const dcFields = {};
    const dcProps = ["title", "creator", "description", "subject", "rights", "format"];
    for (const prop of dcProps) {
        try {
            if (xmp.doesPropertyExist(XMPConst.NS_DC, prop)) {
                const val = xmp.getProperty(XMPConst.NS_DC, prop);
                dcFields[prop] = val.value;
            }
        } catch (e) { /* skip */ }
    }
    if (Object.keys(dcFields).length > 0) metadata.dublinCore = dcFields;

    // XMP Basic (xmp:) -- CreateDate, ModifyDate, CreatorTool
    const xmpBasicFields = {};
    const xmpBasicProps = ["CreateDate", "ModifyDate", "MetadataDate", "CreatorTool", "Label", "Rating"];
    for (const prop of xmpBasicProps) {
        try {
            if (xmp.doesPropertyExist(XMPConst.NS_XMP, prop)) {
                const val = xmp.getProperty(XMPConst.NS_XMP, prop);
                xmpBasicFields[prop] = val.value;
            }
        } catch (e) { /* skip */ }
    }
    if (Object.keys(xmpBasicFields).length > 0) metadata.xmpBasic = xmpBasicFields;

    // Dynamic Media (xmpDM:) -- duration, videoFrameRate, scene, shot, etc.
    // Note: XMPConst.NS_DM may not be available in all UXP versions, so we use the literal URI
    const dmNS = "http://ns.adobe.com/xmp/1.0/DynamicMedia/";
    const dmFields = {};
    const dmProps = [
        "duration", "videoFrameRate", "videoFrameSize", "videoPixelAspectRatio",
        "videoCompressor", "videoFieldOrder", "audioSampleRate", "audioChannelType",
        "audioCompressor", "scene", "shotName", "shotDate", "shotLocation",
        "logComment", "startTimecode", "altTimecode", "tapeName",
        "projectName", "videoAlphaMode", "good"
    ];
    for (const prop of dmProps) {
        try {
            if (xmp.doesPropertyExist(dmNS, prop)) {
                const val = xmp.getProperty(dmNS, prop);
                dmFields[prop] = val.value;
            }
        } catch (e) { /* skip */ }
    }
    if (Object.keys(dmFields).length > 0) metadata.dynamicMedia = dmFields;

    // EXIF (for camera/photo metadata if present)
    const exifFields = {};
    const exifProps = [
        "Make", "Model", "ExposureTime", "FNumber", "ISOSpeedRatings",
        "FocalLength", "LensModel", "GPSLatitude", "GPSLongitude",
        "PixelXDimension", "PixelYDimension"
    ];
    for (const prop of exifProps) {
        try {
            if (xmp.doesPropertyExist(XMPConst.NS_EXIF, prop)) {
                const val = xmp.getProperty(XMPConst.NS_EXIF, prop);
                exifFields[prop] = val.value;
            }
        } catch (e) { /* skip */ }
    }
    if (Object.keys(exifFields).length > 0) metadata.exif = exifFields;

    // XMP Media Management (xmpMM:) -- DocumentID, InstanceID
    const mmFields = {};
    const mmProps = ["DocumentID", "InstanceID", "OriginalDocumentID"];
    for (const prop of mmProps) {
        try {
            if (xmp.doesPropertyExist(XMPConst.NS_XMP_MM, prop)) {
                const val = xmp.getProperty(XMPConst.NS_XMP_MM, prop);
                mmFields[prop] = val.value;
            }
        } catch (e) { /* skip */ }
    }
    if (Object.keys(mmFields).length > 0) metadata.mediaManagement = mmFields;

    return {
        itemName: itemName,
        metadata: metadata,
        rawXml: xmpXml
    };
};


const setProjectMetadata = async (command) => {
    const options = command.options;
    const itemName = options.itemName;
    const metadataFields = options.metadataFields;

    const project = await app.Project.getActiveProject();
    const projectItem = await findProjectItem(itemName, project);

    const { XMPMeta, XMPConst } = require("uxp").xmp;

    const kPProPrivateProjectMetadataURI =
        "http://ns.adobe.com/premierePrivateProjectMetaData/1.0/";

    // Get current metadata
    const currentMetadataXml = await app.Metadata.getProjectMetadata(projectItem);
    const xmp = new XMPMeta(currentMetadataXml);

    // Build the updatedFields array and set each property
    const updatedFields = [];

    for (const [fieldName, fieldValue] of Object.entries(metadataFields)) {
        xmp.setProperty(kPProPrivateProjectMetadataURI, fieldName, String(fieldValue));
        updatedFields.push(fieldName);
    }

    // Serialize the modified XMP back to XML string
    const newMetadataXml = xmp.serialize();

    // Create and execute the set action within a locked transaction
    execute(() => {
        const action = app.Metadata.createSetProjectMetadataAction(
            projectItem,
            newMetadataXml,
            updatedFields
        );
        return [action];
    }, project);

    return {
        itemName: itemName,
        updatedFields: updatedFields
    };
};


const setXMPMetadata = async (command) => {
    const options = command.options;
    const itemName = options.itemName;
    const metadataUpdates = options.metadataUpdates;

    const project = await app.Project.getActiveProject();
    const projectItem = await findProjectItem(itemName, project);

    const { XMPMeta, XMPConst } = require("uxp").xmp;

    // Get current XMP metadata
    const currentXmpXml = await app.Metadata.getXMPMetadata(projectItem);
    const xmp = new XMPMeta(currentXmpXml);

    // Map namespace keys to XMP namespace URIs
    const namespaceMap = {
        "dublinCore": XMPConst.NS_DC,
        "xmpBasic": XMPConst.NS_XMP,
        "dynamicMedia": "http://ns.adobe.com/xmp/1.0/DynamicMedia/",
    };

    const updatedProperties = [];

    for (const [nsKey, properties] of Object.entries(metadataUpdates)) {
        const nsUri = namespaceMap[nsKey];
        if (!nsUri) {
            console.log(`setXMPMetadata: Unknown namespace key "${nsKey}", skipping`);
            continue;
        }

        for (const [propName, propValue] of Object.entries(properties)) {
            xmp.setProperty(nsUri, propName, String(propValue));
            updatedProperties.push(`${nsKey}.${propName}`);
        }
    }

    // Serialize back to XML
    const newXmpXml = xmp.serialize();

    // Create and execute the set action within a locked transaction
    execute(() => {
        const action = app.Metadata.createSetXMPMetadataAction(projectItem, newXmpXml);
        return [action];
    }, project);

    return {
        itemName: itemName,
        updatedProperties: updatedProperties
    };
};

const addMetadataProperty = async (command) => {
    const options = command.options;
    const propertyName = options.propertyName;
    const propertyLabel = options.propertyLabel;
    const propertyType = options.propertyType || "Text";

    // Map string type names to numeric constants.
    // Try app.Metadata constants first; fall back to local METADATA_TYPE values.
    const typeMap = {
        "Integer": (app.Metadata.METADATA_TYPE_INTEGER !== undefined) ? app.Metadata.METADATA_TYPE_INTEGER : METADATA_TYPE.INTEGER,
        "Real":    (app.Metadata.METADATA_TYPE_REAL    !== undefined) ? app.Metadata.METADATA_TYPE_REAL    : METADATA_TYPE.REAL,
        "Text":    (app.Metadata.METADATA_TYPE_TEXT    !== undefined) ? app.Metadata.METADATA_TYPE_TEXT    : METADATA_TYPE.TEXT,
        "Boolean": (app.Metadata.METADATA_TYPE_BOOLEAN !== undefined) ? app.Metadata.METADATA_TYPE_BOOLEAN : METADATA_TYPE.BOOLEAN,
    };

    const typeValue = typeMap[propertyType];
    if (typeValue === undefined) {
        throw new Error(
            `addMetadataProperty: Invalid propertyType "${propertyType}". ` +
            `Valid values are: Integer, Real, Text, Boolean`
        );
    }

    const success = await app.Metadata.addPropertyToProjectMetadataSchema(
        propertyName,
        propertyLabel,
        typeValue
    );

    return {
        propertyName: propertyName,
        propertyLabel: propertyLabel,
        propertyType: propertyType,
        success: success
    };
};

const getProjectPanelMetadata = async (command) => {
    const panelMetadataXml = await app.Metadata.getProjectPanelMetadata();

    // The panel metadata is an XML string describing column configuration.
    // Attempt to parse it into a more useful format using XMPMeta.
    let parsed = null;
    try {
        const { XMPMeta } = require("uxp").xmp;
        const xmp = new XMPMeta(panelMetadataXml);
        // If parsing succeeds, serialize to a compact form
        parsed = xmp.serialize();
    } catch (e) {
        // Not valid XMP -- may be a different XML format.
        // Return raw string only.
    }

    return {
        rawXml: panelMetadataXml,
        parsed: parsed
    };
};


const getClipEffects = async (command) => {
    const options = command.options;
    const id = options.sequenceId;
    const trackIndex = options.trackIndex;
    const trackItemIndex = options.trackItemIndex;
    const trackType = options.trackType || TRACK_TYPE.VIDEO;

    const sequence = await _getSequenceFromId(id);

    if (!sequence) {
        throw new Error("getClipEffects: Requires a valid sequence.");
    }

    const trackItem = await getTrack(sequence, trackIndex, trackItemIndex, trackType);
    const componentChain = await trackItem.getComponentChain();
    const count = componentChain.getComponentCount();

    const effects = [];
    for (let i = 0; i < count; i++) {
        const component = componentChain.getComponentAtIndex(i);
        const matchName = await component.getMatchName();
        const displayName = await component.getDisplayName();
        const paramCount = component.getParamCount();

        effects.push({
            index: i,
            matchName: matchName,
            displayName: displayName,
            paramCount: paramCount
        });
    }

    return { effects };
};

const _serializeParamValue = (value) => {
    if (value === null || value === undefined) {
        return null;
    }

    // Check if it's a nested { value: ... } structure from a Keyframe
    if (typeof value === 'object' && value.value !== undefined && !(value.x !== undefined || value.red !== undefined)) {
        return _serializeParamValue(value.value);
    }

    // PointF -- has x and y properties
    if (typeof value === 'object' && value.x !== undefined && value.y !== undefined) {
        return { x: value.x, y: value.y, _type: "point" };
    }

    // Color -- has red, green, blue properties
    if (typeof value === 'object' && value.red !== undefined && value.green !== undefined && value.blue !== undefined) {
        return {
            red: value.red,
            green: value.green,
            blue: value.blue,
            alpha: value.alpha !== undefined ? value.alpha : 1.0,
            _type: "color"
        };
    }

    // Primitive types (number, string, boolean) pass through directly
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }

    // Fallback: try to convert to string
    try {
        return String(value);
    } catch (e) {
        return null;
    }
};

const getEffectParameters = async (command) => {
    const options = command.options;
    const id = options.sequenceId;
    const trackIndex = options.trackIndex;
    const trackItemIndex = options.trackItemIndex;
    const effectMatchName = options.effectMatchName;
    const trackType = options.trackType || TRACK_TYPE.VIDEO;

    const sequence = await _getSequenceFromId(id);

    if (!sequence) {
        throw new Error("getEffectParameters: Requires a valid sequence.");
    }

    const trackItem = await getTrack(sequence, trackIndex, trackItemIndex, trackType);
    const componentChain = await trackItem.getComponentChain();
    const count = componentChain.getComponentCount();

    // Find the component by match name
    let targetComponent = null;
    let componentIndex = -1;
    for (let i = 0; i < count; i++) {
        const component = componentChain.getComponentAtIndex(i);
        const matchName = await component.getMatchName();
        if (matchName === effectMatchName) {
            targetComponent = component;
            componentIndex = i;
            break;
        }
    }

    if (!targetComponent) {
        throw new Error(
            `getEffectParameters: Effect with match name "${effectMatchName}" not found on this clip. ` +
            `Use get_clip_effects to see available effects.`
        );
    }

    const displayName = await targetComponent.getDisplayName();
    const paramCount = targetComponent.getParamCount();

    const parameters = [];
    for (let j = 0; j < paramCount; j++) {
        const param = targetComponent.getParam(j);

        // Get the start/default value
        let currentValue = null;
        try {
            const startKeyframe = await param.getStartValue();
            if (startKeyframe && startKeyframe.value !== undefined) {
                currentValue = _serializeParamValue(startKeyframe.value);
            }
        } catch (e) {
            // Some params may not support getStartValue; skip gracefully
        }

        // Check if the parameter is time-varying (keyframed)
        let isTimeVarying = false;
        try {
            isTimeVarying = param.isTimeVarying();
        } catch (e) {
            // Some params may not support this check
        }

        // Check if keyframes are supported
        let keyframesSupported = false;
        try {
            keyframesSupported = await param.areKeyframesSupported();
        } catch (e) {
            // Some params may not support this check
        }

        parameters.push({
            index: j,
            displayName: param.displayName,
            value: currentValue,
            isTimeVarying: isTimeVarying,
            keyframesSupported: keyframesSupported
        });
    }

    return {
        effectMatchName: effectMatchName,
        effectDisplayName: displayName,
        effectIndex: componentIndex,
        parameters: parameters
    };
};

const setEffectParameter = async (command) => {
    const options = command.options;
    const id = options.sequenceId;
    const trackIndex = options.trackIndex;
    const trackItemIndex = options.trackItemIndex;
    const effectMatchName = options.effectMatchName;
    const paramName = options.paramName;
    let value = options.value;
    const trackType = options.trackType || TRACK_TYPE.VIDEO;

    const project = await app.Project.getActiveProject();
    const sequence = await _getSequenceFromId(id);

    if (!sequence) {
        throw new Error("setEffectParameter: Requires a valid sequence.");
    }

    const trackItem = await getTrack(sequence, trackIndex, trackItemIndex, trackType);

    // Find the param first so we can give a clear error if not found
    const param = await getParam(trackItem, effectMatchName, paramName);

    if (!param) {
        throw new Error(
            `setEffectParameter: Parameter "${paramName}" not found on effect "${effectMatchName}". ` +
            `Use get_effect_parameters to see available parameters.`
        );
    }

    // Handle PointF values -- convert {x, y} dict to actual value for createKeyframe
    if (typeof value === 'object' && value !== null) {
        if (value.x !== undefined && value.y !== undefined) {
            // Point value -- createKeyframe should accept {x, y} objects
            value = value;
        } else if (value.red !== undefined && value.green !== undefined && value.blue !== undefined) {
            // Color value -- pass through for createKeyframe
            value = value;
        }
    }

    const keyframe = await param.createKeyframe(value);

    execute(() => {
        const action = param.createSetValueAction(keyframe);
        return [action];
    }, project);

    return {
        effectMatchName: effectMatchName,
        paramName: paramName,
        valueSet: value
    };
};

const getEffectParameterValue = async (command) => {
    const options = command.options;
    const id = options.sequenceId;
    const trackIndex = options.trackIndex;
    const trackItemIndex = options.trackItemIndex;
    const effectMatchName = options.effectMatchName;
    const paramName = options.paramDisplayName;
    const timeTicks = options.timeTicks || 0;
    const trackType = options.trackType || TRACK_TYPE.VIDEO;

    const sequence = await _getSequenceFromId(id);

    if (!sequence) {
        throw new Error("getEffectParameterValue: Requires a valid sequence.");
    }

    const trackItem = await getTrack(sequence, trackIndex, trackItemIndex, trackType);

    // Use the existing getParam utility to find the parameter
    const param = await getParam(trackItem, effectMatchName, paramName);

    if (!param) {
        throw new Error(
            `getEffectParameterValue: Parameter "${paramName}" not found on effect "${effectMatchName}". ` +
            `Use get_effect_parameters to see available parameters.`
        );
    }

    // Create a TickTime for the requested time
    const tickTime = app.TickTime.createWithTicks(timeTicks.toString());

    // Get the value at the specified time
    const rawValue = await param.getValueAtTime(tickTime);
    const value = _serializeParamValue(rawValue);

    // Also get metadata about the parameter
    let isTimeVarying = false;
    try {
        isTimeVarying = param.isTimeVarying();
    } catch (e) {
        // Skip
    }

    let keyframesSupported = false;
    try {
        keyframesSupported = await param.areKeyframesSupported();
    } catch (e) {
        // Skip
    }

    return {
        effectMatchName: effectMatchName,
        paramName: paramName,
        timeTicks: timeTicks,
        value: value,
        isTimeVarying: isTimeVarying,
        keyframesSupported: keyframesSupported,
        displayName: param.displayName
    };
};

const exportSequence = async (command) => {
    const options = command.options;
    const sequenceId = options.sequenceId;
    const outputPath = options.outputPath;
    const presetPath = options.presetPath;

    const manager = await app.EncoderManager.getManager();

    const sequence = await _getSequenceFromId(sequenceId);

    await manager.exportSequence(sequence, constants.ExportType.IMMEDIATELY, outputPath, presetPath);
}

const commandHandlers = {
    getProjectMetadata,
    getXMPMetadata,
    setProjectMetadata,
    setXMPMetadata,
    addMetadataProperty,
    getProjectPanelMetadata,
    getClipEffects,
    getEffectParameters,
    setEffectParameter,
    getEffectParameterValue,
    exportSequence,
    moveProjectItemsToBin,
    createBinInActiveProject,
    addMarkerToSequence,
    closeGapsOnSequence,
    removeItemFromSequence,
    setClipStartEndTimes,
    openProject,
    saveProjectAs,
    saveProject,
    getProjectInfo,
    setActiveSequence,
    exportFrame,
    setVideoClipProperties,
    createSequenceFromMedia,
    setAudioTrackMute,
    setClipDisabled,
    appendVideoTransition,
    appendVideoFilter,
    addMediaToSequence,
    importMedia,
    createProject,
};

module.exports = {
    commandHandlers
}