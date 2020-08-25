// Flags
// whether to check for duplicate translation or not during create
var checkduplicate = true;
// whether json is required in translation or not
var jsonrequired = false
// whether to generate latin or not using translate.py script
var generateLatin = true

var fs = require('fs');
var path = require('path');
// Requires for python or other system binaries to launch
var {
  spawnSync
} = require('child_process');
var {
  firefox
} = require('playwright');

// Folder that holds all the translations that needs to be added
var startDir = path.join(__dirname, "start")
// Folder that holds all the quran editions
var editionsFolder = "editions"
var editionsDir = path.join(__dirname, editionsFolder)
// Stores the files for download and as backup
var databaseDir = path.join(__dirname, 'database')
// Stores translations in line by line format of 6236 lines
var linebylineDir = path.join(databaseDir, 'linebyline')
var startUrl = "https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@"
var apiVersion = 'v1'
// API url
var url = startUrl + apiVersion + "/"
// Stores the translation files snippets and it's json,retreieves them from linebylineDir
var jsondb = {}
// spaces to be used for prettify/json.stringify
var prettyindent = 4
// Creating line to [chapter,verseNo] mappings
// Array containing number of verses in each chapters
var chaplength = [7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6]
// contains chapter verse mappings for each line
var mappings = []

for (i = 1; i <= 114; i++) {
  for (j = 1; j <= chaplength[i - 1]; j++) {
    mappings.push([i, j])
  }
}
// capitalizes all the first letters in a sentense
var capitalize = words => words.split(' ').map(w => w[0].toUpperCase() + w.substring(1)).join(' ')
// stores iso codes
var isocodes;
//stores hizb,juz etc start and end
var qinfo;
// stores the google language codes
var gLangCodes;
// https://stackoverflow.com/a/5767589
// access node command line args
var argarr = process.argv.slice(2);
// Page to add translation text and get the direction of text
var page

// function that will run on running this script
async function start() {
  logmsg("\nBEGIN:\n" + process.argv.join(' '), true)
  // Print the help and how to use the script file and arguments, same as given in contribute
  if (argarr[0] == undefined)
    helpPrint()
  else if ("" + argarr[0].toLowerCase().trim() == "create")
    await create()
  else if (argarr[0].toLowerCase().trim() == "update")
    await create(true)
  else if (argarr[0].toLowerCase().trim() == "search")
    search(argarr.slice(1))
  else if (argarr[0].toLowerCase().trim() == "delete") {
    // storing the data in jsondb, so listingsGen function can work and create editions.json
    await jsonDB()
    deleteEditions(argarr.slice(1))
  } else
    helpPrint()

}
// calling start()
start()

// Prints the information on how to use this tool, mirror whatever is written in contribution.md
function helpPrint() {
  var filename = path.basename(__filename);
  console.log("\nUsage: node ", filename, " [arguments]")
  console.log("\n\narguments:")
  console.log("\ncreate\ncreates the database in REST architecture, paste your files in start directory and then run this command\nExample: node ", filename, " create")
  console.log("\nupdate\nupdates the database, copy the edition that needs to be edited from database/chapterverse directory and paste that edition in start directory and then perform any editing you want in the file and then run this command\nExample: node ", filename, " update")
  console.log("\ndelete\ndeletes the edition from database\nExample: node ", filename, " delete editionNameToDelete")
  console.log("\nsearch\nsearches the provided line in database\nExample: node ", filename, ' search "verseToSearch"')
}

// function that will generate the editions, it will take the files from startDir
async function create(update) {
  // saving database snippet, filename and it's json data in jsondb variable
  await jsonDB()
  // saving isocodes in json
  isocodes = fs.readFileSync(path.join(__dirname, 'info', 'iso-codes.min.json')).toString();
  isocodes = JSON.parse(isocodes)
  // saving quran data such as how many rukus, etc, this will be used to generate the rukus endpoint
  qinfo = fs.readFileSync(path.join(__dirname, 'info', 'quran-info.min.json')).toString();
  qinfo = JSON.parse(qinfo)
  // saving google translate language codes in json
  gLangCodes = fs.readFileSync(path.join(__dirname, 'info', 'google-codes.min.json')).toString();
  gLangCodes = JSON.parse(gLangCodes)
  // Launching browser as we will need it for checking direction of the language
  var browser = await firefox.launch();
  var context = await browser.newContext();
  page = await context.newPage();

  // Starting to read files in startDir
  for (var filename of fs.readdirSync(startDir)) {
    logmsg("\nStarting to create files for " + filename)
    // Reading the file and retrieving as array, filteredarr, and jsondata inside it
    // filterarr doesn't contain jsondata and empty lines in it
    var [orgarr, filterarr, jsondata] = readDBTxt(path.join(startDir, filename))
    if (!jsondata) {
      logmsg("\nNo JSON found in file " + filename + " or please enter the json in correct format")
      jsondata = {}
      if (jsonrequired)
        continue
    }
    // validates the translation for mistakes such as extra newline etc and corrects it and clean the translation from any number patterns ,etc
    var cleanarr = validateCleanTrans(filterarr, filename, orgarr)

    if (!Array.isArray(cleanarr)) {
      logmsg("\nproblem in " + filename + " format, so ignoring this file")
      continue
    }
    // Now we have to check and make sure same copy doesn't exists in the repo, here we will use the linebylineDir to check
    var duplicatefilename = checkduplicateTrans(cleanarr)
    // We don't want to check for duplicates during update operation
    if (duplicatefilename && !update) {
      logmsg("\nThis file " + filename + " seems to be a duplicate copy of " + duplicatefilename)
      if (checkduplicate)
        continue
      else
        logmsg("\ncheckduplicate is set to false, so a duplicate copy of this translation will be created in the database")
    }
    // if this is update operation
    if (update) {

      if (!fs.existsSync(path.join(linebylineDir, filename))) {
        logmsg("\nEdition with name " + filename.replace(/(\.[^\.]*$)/i, "") + " does not exist in the database")
        continue
      } else if (jsondata['name'] && filename.replace(/(\.[^\.]*$)/i, "") != jsondata['name']) {
        logmsg("\nYou are trying to change edition name to " + jsondata['name'] + " this should be done only in very rare cases only")
        if (fs.existsSync(path.join(linebylineDir, jsondata['name'] + '.txt'))) {
          logmsg("\nA Edition with same name as " + jsondata['name'] + " exists in the database, you will have to give a new edition name")
          continue
        }
      }
      // Path to edition-la and edition-lad
      var latinDPath = path.join(linebylineDir, filename.replace(/(\.[^\.]*$)/i, "-lad$1"))
      var latinPath = path.join(linebylineDir, filename.replace(/(\.[^\.]*$)/i, "-la$1"))
      // stores the index as key and text as value , it will stores lines having edited changes
      var uniqueobj = {}
      if (fs.existsSync(latinDPath))
        var [, fulllatinarr] = readDBTxt(latinDPath)
      else if (fs.existsSync(latinPath))
        var [, fulllatinarr] = readDBTxt(latinPath)

      // if the edition-la or edition-lad existed
      if (fulllatinarr) {
        // stores the old edition data, this will be used to compare the lines which are having changes
        // so that only the changed line will be used for latin generation, as it's expensive process
        var [, oldEditionArr] = readDBTxt(path.join(linebylineDir, filename))
        // storing unique/edited lines with their index in uniqueobj
        for (var i = 0; i < oldEditionArr.length; i++) {
          if (oldEditionArr[i] != cleanarr[i])
            uniqueobj[i] = cleanarr[i]
        }
      }
      // delete the old editions
      var oldEditionName = filename.replace(/(\.[^\.]*$)/i, "")
      deleteEditions([oldEditionName])
    }
    // generating edition
    logmsg("\nGenerating Edition")
    // if edition name exists in the file during update process, we will use that as edition name
    if (update && jsondata['name'])
      var genJSON = await generateEdition(cleanarr, jsondata, jsondata['name'])
    else
      var genJSON = await generateEdition(cleanarr, jsondata)

    if (update) {
      // if this is update operation, then we will give more preference to json data from file, instead of generated json data
      for (var [key, val] of Object.entries(genJSON)) {
        if (jsondata[key] && !key.includes('link') && key != 'direction')
          genJSON[key] = jsondata[key]
      }
    }

    // if the language is latin diacritical, then we will generate a non diacritical version attaching -la to it
    if (isLatin(cleanarr) && isDiacritic(cleanarr)) {
      logmsg("\nGenerating non diacritical Edition")
      var nonDiacriticarr = cleanarr.join('\n').normalize('NFD').replace(/[\u0300-\u036f]/g, '').split('\n')
      // generating edition
      var latinGenJSON = await generateEdition(nonDiacriticarr, jsondata, genJSON['name'] + '-la')
    }
    // we will try to  generate latin script if the language is not latin, it will make it easier for users to read the translation
    // who studied in english, but have a different mother tongue and are not well versed in reading the mother tongue script, for example me
    else if (!isLatin(cleanarr) && generateLatin) {
      logmsg("\nPlease wait trying to generate latin script for this translation, it will take 5-10mins to complete")
      var genLatinarr
      // if this is create operation or if the latin script forr the edition doesn't exist, we will try building one
      if (!update || !fulllatinarr)
        genLatinarr = genLatin(cleanarr)
      else if (Object.keys(uniqueobj).length == 0) {
        // if there are no edited lines in the updated translation, maybe only json data was updated in the file
        // So we will use the old latin translation
        genLatinarr = fulllatinarr
      } else {
        // generating latin only for edited lines
        var latinreturn = genLatin(Object.values(uniqueobj))
        var i = 0
        // The return latin script should be an array and the no of lines we passed, should be returned back
        if (Array.isArray(latinreturn) && Object.keys(uniqueobj).length == latinreturn.length) {
          for (var key of Object.keys(uniqueobj))
            fulllatinarr[key] = latinreturn[i++]
        }
        genLatinarr = fulllatinarr
      }
      // if the latin script was generated, then we will use that to generate editions with -la and -lad appended to it
      if (Array.isArray(genLatinarr) && isLatin(genLatinarr) && genLatinarr.length == 6236) {
        // assuming the generated latin is non diacritical
        var nonDiacriticarr = genLatinarr
        logmsg("\nCreating Latin Script for the language")
        // generating diacritical variant and non diacritical variant if the generated latin script is diacritical
        if (isDiacritic(genLatinarr)) {
          logmsg("\nGenerating diacritical and non diacritical Editions for this langauge")
          await generateEdition(genLatinarr, jsondata, genJSON['name'] + '-lad')
          // generating non diacritical variant array
          nonDiacriticarr = genLatinarr.join('\n').normalize('NFD').replace(/[\u0300-\u036f]/g, '').split('\n')
        }
        // Generate non diacritical variant
        var latinGenJSON = await generateEdition(nonDiacriticarr, jsondata, genJSON['name'] + '-la')
      }
    }
    // move the file for which update/create have been completed from startDir to originals dir
    fs.renameSync(path.join(startDir, filename), path.join(databaseDir, "originals", filename))
  }
  // Generate the editions.json and fonts.json
  listingsGen()
  // close the browser when everything is done
  await browser.close();
}

// This function is a wrapper to generate json and generate the files in the database
async function generateEdition(arr, jsondata, editionName) {
  var genJSON
  // use the editionName to generateJSON if it's defined
  if (editionName)
    genJSON = await generateJSON(arr, jsondata, editionName)
  else
    genJSON = await generateJSON(arr, jsondata)

  // generate files in database
  generateFiles(arr, genJSON)
  // save the json data and snippet inside the jsondb variable
  await jsonDB(genJSON['name'] + '.txt')
  logmsg("\n Generated edition " + genJSON['name'])

  return genJSON
}
// Generate the files and folder for the edition in REST architecture
function generateFiles(arr, json) {

  for (var key of Object.keys(qinfo)) {
    // we don't want to generate for verses,chapters, as it's generation logic is different
    if (key != "verses" && key != "chapters" && key != "sajdas") {
      fs.mkdirSync(path.join(editionsDir, json['name'], key), {
        recursive: true
      });
      for (var j = 0; j < qinfo[key]['references'].length; j++) {

        var fromchap = qinfo[key]['references'][j].start.chapter
        var fromverse = qinfo[key]['references'][j].start.verse
        if (qinfo[key]['references'][j + 1]) {
          var tochap = qinfo[key]['references'][j + 1].start.chapter
          var toverse = qinfo[key]['references'][j + 1].start.verse
        } else {
          var tochap = ""
          var toverse = ""
        }
        // writing the chapter and verse in the specified folder
        chapVerseWriter(fromchap, fromverse, tochap, toverse, arr, path.join(editionsDir, json['name'], key, j + 1 + ''), key)
      }
    }
  }
  // save whole quran json
  chapVerseWriter(1, 1, "", "", arr, path.join(editionsDir, json['name']), 'quran')

  var k = 0
  // creating chapter and single verse json
  for (var i = 1; i <= 114; i++) {
    fs.mkdirSync(path.join(editionsDir, json['name'], i + ''), {
      recursive: true
    });
    // writing chapter json
    chapVerseWriter(i, 1, i, chaplength[i - 1], arr, path.join(editionsDir, json['name'], i + ''), 'chapter', true)
    for (var j = 1; j <= chaplength[i - 1]; j++) {
      // creating single verse json
      var vjson = {}
      vjson['chapter'] = i
      vjson['verse'] = j
      vjson['text'] = arr[k++]
      fs.writeFileSync(path.join(editionsDir, json['name'], i + '', j + ".min.json"), JSON.stringify(vjson))
      fs.writeFileSync(path.join(editionsDir, json['name'], i + '', j + ".json"), JSON.stringify(vjson, null, prettyindent))
    }
  }
  // attaching chap|verseno|versetext  to array
  var chapversearray = arr.map((value, index) => mappings[index][0] + '|' + mappings[index][1] + '|' + value)
  // saving in chapterverse folder as back
  fs.writeFile(path.join(databaseDir, 'chapterverse', json['name'] + ".txt"), chapversearray.join('\n') + '\n' + JSON.stringify(json, null, prettyindent), err => {
    if (err) throw err
  })
  // saving in linebylineDir as back
  fs.writeFileSync(path.join(linebylineDir, json['name'] + ".txt"), arr.join('\n') + '\n' + JSON.stringify(json, null, prettyindent))
}


// validates the translation and returns a clean translation without the numbers etc
function validateCleanTrans(arr, filename, orgarr) {
  // In proper format if the number of lines are 6236
  if (arr.length == 6236) {
    return cleanTrans(arr)
  }
  // asuuming there is number pattern of verses such as 1|1|Praise be to God
  else {
    var j = 0;
    var stop = 0
    // specifies the limit, i.e next number of lines to search for next verse
    var limit = 10
    // stores the last line string which had valid number pattern like 1|1|Praise be to God
    var laststr;
    // stores the numbers from line
    var numsarr;
    for (i = 0; i < arr.length; i++) {
      // getting the numbers for verse
      numsarr = arr[i].match(/\d+/g) || []
      // Checking number patter of verses, j is the line number and mappings[j][1] accesses the verse number in that specific line number
      // we are checking that this line has same verse number as in mappings
      if (mappings[j] && numsarr.includes(mappings[j][1] + '')) {
        j++;
        // storing the line with valid number pattern
        laststr = arr[i];
        // resetting the stop as we found a valid verse line
        stop = 0
      } else {
        // merging the newline content assuming it's part of verse, as we did not find next verse pattern
        arr[i - 1] = arr[i - 1] + " " + arr[i]
        //  console.log("merged " + arr[i - 1])
        logmsg("\nmerged the below line \n" + arr[i - 1], true)
        // deleting the current line as it is already merged with previous line
        arr.splice(i, 1)
        // Going back to the previous line containing the merged content
        i--;
        // if the limit is reached and we still did not find the next verse, we will stop, as the translation is not in correct format
        if (stop++ == limit)
          break;
      }
    }
    // if the above loop went till end i.e  6236 lines without finding any invalid verse pattern line, it means the file is in proper format
    if (j == mappings.length)
      return cleanTrans(arr)
    else
      logmsg("\nerror while checking the " + filename + " it might be missing chapter " + mappings[j][0] + " and verse " + mappings[j][1] + " check at roughly lineno " + orgarr.indexOf(laststr) + 1 + " after or before the line '" + laststr + "' ,error will be somewhere near this line")
  }
}

// clean the string from special symbols,numbers,multiple spaces etc , this is used for string comparision
function cleanify(str) {
  return str.replace(/[\u0020-\u0040|\u005b-\u0060|\u007b-\u007e|\s|\n]+/gi, " ").replace(/^\s*\w{1}\s+/i, " ").replace(/\s\s+/g, " ").trim().toLowerCase()
}

// Cleaning translation from numbers, special symbols etc
function cleanTrans(arr) {
  for (i = 0; i < arr.length; i++) {
    // https://en.wikipedia.org/wiki/List_of_Unicode_characters#Basic_Latin
    // This will remove all special symbols and numbers from starting and ending of verse
    arr[i] = arr[i].replace(/^[\u0020-\u0040|\u005b-\u0060|\u007b-\u007e|\s|\n]{1,20}/, " ").replace(/^\s*\w{1}\s*(\.|\)|\}|\>|\])+[\u0020-\u0040|\u005b-\u0060|\u007b-\u007e|\s|\n]{0,7}/i, " ").replace(/[\u0020-\u0040|\u005b-\u0060|\u007b-\u007e|\s|\n]{1,15}$/, " ").replace(/\s\s+/g, " ").trim()

    // Checking partially open/close bracket exists or not at begninning of verse
    var bracket1 = arr[i].match(/^[^\[|\(|\<|\{]+(\]|\)|\>|\})/)
    // Checking partially open/close bracket exists or not at end of verse
    var bracket2 = arr[i].match(/(\[|\(|\<|\{)[^\]|\)|\>|\}]+$/)

    // closing partially open/close bracket in the verse
    // closing partially open/close bracket at the beginning of verse
    if (bracket1)
      arr[i] = getOppoBracket(bracket1[0].slice(-1)) + arr[i]
    // closing partially open/close bracket at the end of verse
    if (bracket2)
      arr[i] = arr[i] + getOppoBracket(bracket2[0].slice(0, 1))
  }
  return arr
}

// returns opposite bracket
function getOppoBracket(str) {
  switch (str) {
    case '(':
      return ')'
    case ')':
      return '('
    case '<':
      return '>'
    case '>':
      return '<'
    case '[':
      return ']'
    case ']':
      return '['
    case '{':
      return '}'
    case '}':
      return '{'
    default:
      return ''
  }
}

// function to delete list of editions from the database
// This will also remove the auto generated -la and -lad of edition
function deleteEditions(arr) {
  var deleted = false
  for (var val of arr) {
    for (var editionname of [val, val + '-la', val + '-lad']) {
      // array containing paths to delete
      var pathsarr = []
      pathsarr.push(path.join(editionsDir, editionname))
      pathsarr.push(path.join(editionsDir, editionname + '.json'))
      pathsarr.push(path.join(editionsDir, editionname + '.min.json'))
      pathsarr.push(path.join(linebylineDir, editionname + '.txt'))
      pathsarr.push(path.join(databaseDir, 'chapterverse', editionname + '.txt'))

      for (var pathToDelete of pathsarr) {
        if (fs.existsSync(pathToDelete)) {
          deleted = true
          if (fs.statSync(pathToDelete).isDirectory())
            fs.rmdirSync(pathToDelete, {
              recursive: true
            })
          else
            fs.unlinkSync(pathToDelete)
        }
      }
      // Deleting also from temporary jsondb variable
      delete jsondb[editionname + '.txt']
      logmsg("\n deletion completed for " + editionname)
    }
  }
  // Generate the editions.json and fonts.json, if any of the file was deleted
  if (deleted)
    listingsGen()
}

// reads the jsondb variable to generate editions.json, and to reads fonts folder to generate fonts.json
function listingsGen() {
  var newjsondb = {}
  // we will always keep the editions.json in sorted order, so it's easier to find
  var sortedkeys = Object.keys(jsondb).sort()
  for (var name of sortedkeys) {
    // removing .txt from filename and replace dash with underscore as many programming languages doesn't support - (dash) in json object key
    var newname = name.replace(/\..*/gi, "").replace(/-/gi, "_")
    newjsondb[newname] = jsondb[name]['jsondata']
  }

  fs.writeFileSync(editionsDir + ".json", JSON.stringify(newjsondb, null, prettyindent))
  fs.writeFileSync(editionsDir + ".min.json", JSON.stringify(newjsondb))

  var fontsarr = fs.readdirSync(path.join(__dirname, 'fonts'))

  for (var fontname of fontsarr) {
    // Getting the extension of fontname
    var extension = fontname.match(/\.[^\.]*$/gi) || [""]
    // Replacing the special symbols,spaces etc with - and lowering the case
    var name = fontname.replace(extension[0], "").replace(/[^A-Z0-9]/gi, " ").replace(/([A-Z])/g, " $1").trim().replace(/\s\s*/g, "-").toLowerCase() + extension[0].toLowerCase().trim()
    // renaming the fonts to proper names and removing special symbols etc
    fs.renameSync(path.join(__dirname, 'fonts', fontname), path.join(__dirname, 'fonts', name))
  }
  // getting sorted array of fonts
  fontsarr = fs.readdirSync(path.join(__dirname, 'fonts')).sort()
  var fontjson = {}

  // generating fontjson
  for (var fontname of fontsarr) {
    // Getting the extension of fontname
    var extension = fontname.match(/\.[^\.]*$/gi) || [""]
    // Removing the extension from fontname and also changing the dash to underscore  as many programming languages doesn't support - (dash) in json
    var keyname = fontname.replace(extension[0], "").replace(/-/gi, "_")
    // we don't want to define again if it's already defined, otherwise it will replace the previous values
    if (!fontjson[keyname])
      fontjson[keyname] = {}

    var innerkey = extension[0].trim().substring(1)
    fontjson[keyname][innerkey] = url + 'fonts/' + fontname
  }
  fs.writeFileSync(path.join(__dirname, "fonts.json"), JSON.stringify(fontjson, null, prettyindent))
  fs.writeFileSync(path.join(__dirname, "fonts.min.json"), JSON.stringify(fontjson))
}

// Stores the translation files snippets and it's json,retreieves them from linebylineDir
async function jsonDB(singlefile) {
  for (var filename of fs.readdirSync(linebylineDir)) {
    // if single file is defined, we will break the loop at end, we will only read that particular files data into jsondb object
    if (singlefile)
      filename = singlefile

    var filepath = path.join(linebylineDir, filename)
    // read the file 40k bytes of file to be stored as snippet in jsondb object
    var data = await streamRead(filepath, 0, 40000)

    jsondb[filename] = {}
    // taking verse from line 11 to 20 and storing it for searching and duplicate detection
    jsondb[filename]['snippet'] = data.split(/\r?\n/).slice(10, 20).join('\n')
    // reading last 3k bytes of file to fetch json
    data = await streamRead(filepath, fs.statSync(filepath).size - 3000)
    // parse the json
    jsondb[filename]['jsondata'] = getJSONInArray(data.split(/\r?\n/))[0]
    // break the loop, as we only wanted to add one file
    if (singlefile)
      break;
  }
}

// reads the file using streams, start is the starting byte and end is the bytes to read
async function streamRead(pathtofile, start, end) {
  var readstream;
  if (start && !end)
    readstream = fs.createReadStream(pathtofile, {
      start: start
    });
  else if (!start && end)
    readstream = fs.createReadStream(pathtofile, {
      end: end
    });
  else if (!start && !end)
    readstream = fs.createReadStream(pathtofile);
  else
    readstream = fs.createReadStream(pathtofile, {
      start: start,
      end: end
    });

  var data = ''
  for await (var chunk of readstream) {
    data = data + chunk.toString()
  }
  return data
}

// gets the JSON from end of array, returns [jsondata, i], where i is the position from end where jsondata was parsed successfully
function getJSONInArray(arr) {
  var i = 0
  while (!isValidJSON(arr.slice(--i).join('\n')) && i > -100);
  if (i != -100)
    return [JSON.parse(arr.slice(i).join('\n')), i]
}

// Checks for duplicate files in the database
function checkduplicateTrans(arr) {
  for (var filename of fs.readdirSync(linebylineDir)) {
    if (cleanify(arr.join('\n')).includes(cleanify(jsondb[filename]['snippet'])))
      return filename
  }
}

// cleans the json from file and generates with standard naming conventions
async function generateJSON(arr, jsondata, editionName) {
  // lowercase for all json , trimming white spaces and also removing empty json and also cleaning the keys and values
  //https://stackoverflow.com/a/54985484/2437224
  var newjson = Object.fromEntries(
    Object.entries(jsondata).map(([k, v]) => {
      if (v != undefined && v)
        return ["" + k.replace(/[^A-Za-z]+/gi, "").trim().toLowerCase(), "" + v.replace(/\s\s+/gi, " ").trim()]
      return ["", ""]
    })
  );
  // removing empty keys
  delete newjson[""]

  // Cleaning or defining the language
  if (!newjson['language']) {
    // detect langauge if it's not already defined
    temp = isoLangMap(detectLang(arr))
  } else {
    // mapping the langauge name to iso langauge name
    temp = isoLangMap([newjson['language']])
    // if the above fails, then we will have to detect the language
    if (!Array.isArray(temp))
      temp = isoLangMap(detectLang(arr))
  }

  if (!Array.isArray(temp))
    logmsg("\n\nplease specify the language in json ")
  // The script will stop execution if translate.py wasn't able to detect the language and temp is not an array
  newjson['language'] = temp[0]
  var isocode = temp[1]
  // capitalize first letters
  newjson['language'] = capitalize(newjson['language'])
  if (!newjson['author'])
    newjson['author'] = "unknown"

  // Removing special symbols and diacritics from authors name
  newjson['author'] = newjson['author'].normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z\s\.\,]+/gi, " ").replace(/\s\s+/gi, " ").toLowerCase().trim()
  newjson['author'] = capitalize(newjson['author'])

  // Defining the undefined values
  if (!newjson['source'])
    newjson['source'] = ""
  if (!newjson['comments'])
    newjson['comments'] = ""


  // Number of chars to consider in author name for editionName creation
  var authorSize = 15
  // Take first few chars of like 10chars for author to make editionName
  // editionName will be a foldername and also part of url, so cannot have anything other than latin alphabets
  if (!editionName)
    editionName = isocode + "-" + newjson['author'].toLowerCase().replace(/[^A-Za-z]+/gi, "").substring(0, authorSize);

  // first check file with same endpoint exists or not in editions.json, if there then we will add 1 to the editionname and check again
  for (var i = 1;; i++) {
    // If a filename with same edition name exists in database then add number to the editionName
    if (jsondb[editionName + '.txt'] || jsondb[editionName + '-la.txt'] || jsondb[editionName + '-lad.txt'])
      editionName = editionName + i;
    else
      break;
  }

  newjson['name'] = editionName
  newjson['link'] = url + editionsFolder + "/" + editionName + ".json"
  newjson['linkmin'] = url + editionsFolder + "/" + editionName + ".min.json"
  newjson['direction'] = await dirCheck(arr.slice(0, 10).join('\n'))

  // JSON in sorted order
  var sortjson = {}
  sortjson['name'] = newjson['name']
  sortjson['author'] = newjson['author']
  sortjson['language'] = newjson['language']
  sortjson['direction'] = newjson['direction']
  sortjson['source'] = newjson['source']
  sortjson['comments'] = newjson['comments']
  sortjson['link'] = newjson['link']
  sortjson['linkmin'] = newjson['linkmin']

  return sortjson
}

// writes chapter and verse in json and .min.json format
function chapVerseWriter(fromChap, fromVerse, toChap, toVerse, arr, pathname, keyname, inclusive) {
  // Get index of [fromChap,fromVerse] in mappings array
  var fromIndex = (elem) => elem[0] == fromChap && elem[1] == fromVerse;
  var from = mappings.findIndex(fromIndex)
  // Get index of [toChap,toVerse] in mappings array
  var toIndex = (elem) => elem[0] == toChap && elem[1] == toVerse;
  var to = mappings.findIndex(toIndex)
  // If inclusive flag is given then we will include the last to verse also during generation
  if (inclusive)
    ++to

  // if toChap and toVerse is not defined or empty, then we will create till end
  if (!toChap && !toVerse)
    to = arr.length

  var tempmap = mappings
  // stores the lines to be written
  arr = arr.slice(from, to)
  var tempmap = mappings.slice(from, to)
  var json = {}
  json[keyname] = []
  //console.log('hi',to)
  for (i = 0; i < tempmap.length; i++) {
    json[keyname][i] = {}
    json[keyname][i]['chapter'] = tempmap[i][0]
    json[keyname][i]['verse'] = tempmap[i][1]
    json[keyname][i]['text'] = arr[i]
  }

  fs.writeFile(pathname + ".json", JSON.stringify(json, null, prettyindent), err => {
    if (err) throw err
  })
  // writing minified version also
  fs.writeFile(pathname + ".min.json", JSON.stringify(json), err => {
    if (err) throw err
  })
}

// This function checks the direction of the language and returns either rtl or ltr
// https://playwright.dev/#version=v1.3.0&path=docs%2Fcore-concepts.md&q=evaluation
async function dirCheck(str) {
  var result = await page.evaluate(str => {
    var divelem = document.createElement("div");
    divelem.dir = "auto"
    divelem.innerHTML = str;
    document.body.appendChild(divelem)
    return window.getComputedStyle(divelem).getPropertyValue('direction')
  }, str);
  return result
}

// Detects lang of the translation, if no language is provided in the json and jsonrequired is set to false
function detectLang(arr) {
  // No of lines to take of the translation to detect the langauge
  var linesToTake = 7
  var result = runPyScript(path.join(__dirname, 'translate.py'), ['detect', arr.slice(0, linesToTake).join('\n')])
  result = JSON.parse(result).lang

  for (var [code, lang] of Object.entries(gLangCodes)) {
    if (code.toLowerCase() == result.toLowerCase())
      return [lang, code]
  }
  // we will compare return google translate code with isocodes list, if the above logic failed
  for (var [lang, val] of Object.entries(isocodes)) {
    if (val.iso1.toLowerCase() == result.toLowerCase() || val.iso2.toLowerCase() == result.toLowerCase())
      return [lang, val.iso2]
  }
  return "unknown"
}

// Returns the iso name ,iso2 of the language
function isoLangMap(arrval) {
  for (var [lang, val] of Object.entries(isocodes)) {
    if (arrval[0].toLowerCase().replace(/[^A-Za-z\(\)]+/gi, "").trim() == lang.toLowerCase().replace(/[^A-Za-z\(\)]+/gi, "").trim())
      return [lang, val.iso2]
  }
  if (arrval[1]) {
    for (var [lang, val] of Object.entries(isocodes)) {
      if (val.iso1 == arrval[1] || val.iso2 == arrval[1])
        return [lang, val.iso2]
    }
  }
}

// Check whether the given array is latin script or not
function isLatin(arr) {
  var content = arr.join('\n')
  var length = content.length
  var afterlength = content.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\w\s]+/gi, "").length
  // After removing latin alphabets, if length is reduce to less than 50%, then it means the script was latin
  if (length / 2 > afterlength)
    return true

  return false
}

// Check whether the given array has diacritical marks or not
function isDiacritic(arr) {
  var content = arr.join('\n')
  var length = content.length
  var afterlength = content.normalize('NFD').length
  // if afterlength is increased, then it means it cotains diacritical symbols
  // we are reducing the afterlength value by 1%, even then it is greater than initial length, that means t contains diacritical symbols
  if (length < afterlength * 0.99)
    return true

  return false
}

function genLatin(arr) {
  // max chars for which latin can be generated, this is what google translate supports through pytranslate library
  var maxLatin = 1500
  // first check whether google gives the latin or not
  var result = runPyScript(path.join(__dirname, 'translate.py'), arr.slice(0, 10).join('\n').substring(0, maxLatin))
  var result = JSON.parse(result)
  // If the place were latin is found is array then it means latin generation is not supported for this langauge
  if (Array.isArray(result[0]['extra_data'].translation.slice(-1)[0].slice(-1)[0])) {
    logmsg("\nLatin script not supported for this langauge, skipping latin script generation")
    return
  }
  var delimiter = '\/'
  var holderarr = []
  holderarr[0] = ""
  var temp = ""
  var i = 0
  // Each index of holderarr will have translation text of 1500 or less than that
  for (var val of arr) {
    temp = temp + val + delimiter
    // Add line to the same index of holderarr only if the character length is less than maxLatin i.e 1500
    if (temp.length < maxLatin)
      holderarr[i] = holderarr[i] + val + delimiter
    else {
      i++
      holderarr[i] = val + delimiter
      temp = val + delimiter
    }
  }
  i = 0;
  // This will store the returned result from translate script
  var fullresult = []
  // max subarray we can give while calling the translate script
  var maxarr = 10
  while (holderarr.length > 0) {
    // Can give around 10 or something arrays to the script , which is equal to maxLatin*10 characters i.e 1500*10
    result = runPyScript(path.join(__dirname, 'translate.py'), holderarr.splice(0, maxarr))
    result = JSON.parse(result)
    // removing last element as it's empty space returned by translate.py
    result.splice(-1)
    fullresult = fullresult.concat(result)
  }


  var fullval = ""
  // storing the latin translation in string
  for (var val of fullresult)
    fullval = fullval + val['extra_data'].translation.slice(-1)[0].slice(-1)[0] + delimiter

  //var latinarr = fullval.split(/\r?\n/);
  // Clean the returned array from translate.py, remove empty lines and trim the verse line
  var latinarr = fullval.split(delimiter).filter(elem => !/^\s*$/.test(elem)).map(s => s.trim())
  if (latinarr.length == 6236)
    logmsg("\nlatin script generated for this language")

  return latinarr
}

// This will make the python 3 script run in multiple os environments
// https://stackoverflow.com/questions/20643470/execute-a-command-line-binary-with-node-js
// https://stackoverflow.com/a/35586247
// https://medium.com/swlh/run-python-script-from-node-js-and-send-data-to-browser-15677fcf199f
function runPyScript(pathToScript, args) {
  // Using windows py to run python version 3
  var output = spawnSync('py', ['-3', pathToScript].concat(args))
  // Using python3 binary to run python version 3, if above fails
  if (output.error)
    output = spawnSync('python3', [pathToScript].concat(args))
  // assuming python 3 is named as python in the system
  if (output.error)
    output = spawnSync('python', [pathToScript].concat(args))
  if (output.error)
    console.log("Python 3 is not installed in the system, please install it")

  return output.stdout.toString();
}

// reads the text file and returns [originalarr, filtererdarr, jsondata]
function readDBTxt(pathToFile) {
  var orgarr = fs.readFileSync(pathToFile).toString().split(/\r?\n/)
  // now remove all lines with empty strings or spaces or tabs
  // https://stackoverflow.com/a/281335
  // return elememnt only if they are not spaces/tabs and emptyline
  var filterarr = orgarr.filter(elem => !/^\s*$/.test(elem))
  // search & validate JSON in array
  var temp = getJSONInArray(filterarr)
  if (Array.isArray(temp))
    return [orgarr, filterarr.slice(0, temp[1]), temp[0]]
  else
    return [orgarr, filterarr]
}

// searches the string in whole linebyline database
function search(arr) {
  var found = false
  for (var val of arr) {
    for (var filename of fs.readdirSync(linebylineDir)) {
      var content = fs.readFileSync(path.join(linebylineDir, filename)).toString();
      str = cleanify(val)
      content = cleanify(content)

      if (content.includes(str)) {
        logmsg("\n Line: " + val + " contains in edition \n" + filename.replace(/(\.[^\.]*$)/i, ""))
        found = true
      }
    }
  }
  if (!found)
    logmsg("\n No edition found in the database")
}

// function which checks whether a string is valid json or not
function isValidJSON(str) {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

// Stores all the log, to help in reviewing PR and checking for any mistake by the user
function logmsg(str, skipconsole) {
  fs.appendFileSync(path.join(__dirname, "log.txt"), str)
  if (!skipconsole)
    console.log(str)
}
