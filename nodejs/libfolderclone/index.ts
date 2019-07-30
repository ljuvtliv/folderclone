import {google,GoogleApis} from "googleapis";
import * as path from "path";
import * as fs from "fs";
export class LibFolderClone{
  private mode: string;
  private action: string;
  private modifiers: Array<String>;

  private basedir:string;

  //Im using these for loading service accounts
  private SA_accounts: Array<any>;
  private SA_instances: Array<any>;
  private SA_auths: Array<any>;
  private num_to_load: number;
  private num_loaded: number;
  private ready: boolean;

  private current_SA:number;


  //driveq houses our queue for copying
  //waitout is a timestamp in the future if copying fails to wait and then resume queue
  private driveq: Array<any>;
  private waitout: any;
  private copies_in_progress: number; //Number of _copy that have yet to finish.

  private copied: Array<any>;
  private skipped: Array<any>;
  private errors:Array<any>;
  public isReady(){
    let that = this;
    return new Promise((reject,resolve) => {
        (function checkReady(timeout){
            if (!timeout) return reject("SA_LOAD_TIMEOUT");
            if(that.ready){resolve(true)}else{
              setTimeout(() => checkReady(timeout-1), 250);
            }
        })(15)
    })
  }
  private _SA_Loaded(name,sa){
    this.SA_auths[name] = sa;
    this.num_loaded +=1;
    this.SA_instances[name] = google.drive({version: 'v3',auth:this.SA_auths[name]});
    if(this.num_loaded >= this.num_to_load){
      this.ready = true;
      console.log('ready')
    }
  }
  constructor(args){
    //load defaults then override

    this.mode = "";
    this.action = "";
    this.modifiers = [];
    this.basedir = args.basepath; //error handling todo

    this.SA_accounts = [];
    this.SA_auths = [];
    this.SA_instances = [];
    this.current_SA = 1;

    this.num_to_load = 0;
    this.num_loaded = 0;
    this.ready = false;

    this.driveq = Array(0);
    this.copies_in_progress = 0;

    this.copied = [];
    this.skipped = [];
    this.errors = [];

    this._init();
  }
  public async _init(){
    try {
      let that = this; //js be wonky with context
      const dir_accounts = path.join(this.basedir, 'accounts');
      await fs.readdir(dir_accounts,function (err, files) {
            if (err) {
                console.error('Error reading directory: accounts, Does it exist?');
                return console.error(err)
            }
            that.num_to_load = files.length;
            files.forEach(function (file) {

                let rawdata = fs.readFileSync(path.join(dir_accounts,file));
                let account = JSON.parse(rawdata.toString());
                let name = file.replace(/\.[^/.]+$/, "");
                that.SA_accounts[name] = account;
                let jwtClient = new google.auth.JWT(account.client_email,null,account.private_key,['https://www.googleapis.com/auth/drive']);
                jwtClient.authorize(async function (err, tokens) {
                     if (err) { console.log(err); return; } else {
                       that._SA_Loaded(name,jwtClient); //We start the SA instance in this function
                    }
                });
            });
      });
    } catch (err) { console.error(err); }

  }
  public async run(input,output){
      if(!this.ready){return("ERR_NOT_READY")}
      setInterval(this.doQueue.bind(this),25);

      this._copy(input,output).then(function(){})
      setInterval(this.checkDone.bind(this),1000);

  }
  logToFile(file){

  }
  async WriteLogs(){
    var dir = this.basedir;
    var out = fs.createWriteStream(dir+'/logs/copying.log');
    out.on('error', function(err) { /* error handling */ });
    for (var i in this.copied) {
        out.write("Copied file:"+this.copied[i]['name']+" to:"+this.copied[i]['destination']+"\n")
    }
    out.end();

    var out = fs.createWriteStream(dir+'/logs/skipping.log');
    out.on('error', function(err) { /* error handling */ });
    for (var i in this.skipped) {
        out.write("Skipped file:"+this.skipped[i]['name']+" Exists at:"+this.skipped[i]['destination']+"\n")
    }
    out.end();

    var out = fs.createWriteStream(dir+'/logs/errors.log');
    out.on('error', function(err) { /* error handling */ });
    for (var i in this.errors) {
        out.write("Error on file:"+this.errors[i]['name']+"\n")
    }
    out.end();

  }
  async checkDone(){ //Will implement process exit here.
    if(this.copies_in_progress == 0){
      //console.log(this.copied);
      if(this.driveq.length == 0){
        console.log('doneworking');
        await this.WriteLogs();
        process.exit(0);
      }else{
        return false;
      }
    }else{
      return false;
    }
  }
  //Here we run the queue
  private async doQueue(){

    if(this.waitout !== undefined && this.waitout >= Date.now()){
      return; //Not doing work
    }else{
      this.waitout = undefined;
    }
    if(this.driveq.length == 0){
      return; //no work for us;
    }
    let q_item = this.driveq.pop();
    this.copied.push(this.driveq);

    //let res = await this._drive_copy(this.getSA(),q_item.source,q_item.destination);
    let res = true;
    if(true){
      console.log('Pushing back onto stack')
      this.driveq.push(q_item);
      this.errors.push(q_item);

      this.waitout = new Date(Date.now() + 1 * 60000);
      return;
    }else{
      console.log('Files remaining:'+this.driveq.length);
    }
  }
  //I use this to juggle between the available SA's, Each call returns a new SA.
  private getSA(num:number = undefined){
    if(num !== undefined){
      return this.SA_instances[num];
    }
    this.current_SA += 1;
    if(this.current_SA >= this.SA_instances.length){
      this.current_SA = 1
    }
    return this.SA_instances[this.current_SA];
  }

  async _copy(source,destination){
      this.copies_in_progress += 1;
      let SA = this.getSA()
      let filestocopy = null;
      let filesindir = null;
      let folderstocopy = null;
      let foldersindir = null;
      /*
        Sometimes the api call to list files will fail and it is required to continue
        On the next while loop it will use a new SA to dodge rate limits on the current one.
        Infinite while loop if it never resolves so TODO check for that.
       */
      while(true){
        if(filestocopy == null){
          filestocopy = await this._drive_list_file(this.getSA(),source)
        }else{break;}
      }
      while(true){
        if(filesindir == null){
          filesindir = await this._drive_list_file(this.getSA(),destination)
        }else{break;}
      }
      while(true){
        if(foldersindir == null){
          foldersindir = await this._drive_list_folder(this.getSA(),destination)
        }else{break;}
      }
      while(true){
        if(folderstocopy == null){
          folderstocopy = await this._drive_list_folder(this.getSA(),source)
        }else{break;}
      }
      if(filestocopy.length > 0){
        for(var key in filestocopy){
          let name = filestocopy[key]['name']
          //var finding = filesindir.find(o => o.name === name);
          var finding = filesindir.findIndex(obj => obj.name === name);
          if(finding == -1){
              console.log("COPYING:"+name)
              this.driveq.push({"source":filestocopy[key]['id'],"destination":destination,"name":filestocopy[key]['name']});
          }
          else{
              this.skipped.push({"source":filestocopy[key]['id'],"destination":destination,"name":filestocopy[key]['name']});
              console.log("SKIPPING FILE:"+name)
          }
        }
      }
      for(var folder in folderstocopy){
            let name = folderstocopy[folder]['name']
            var finding = foldersindir.find(o => o.name === name);
            if(finding !== undefined){
              console.log('Recursing into existing folder:'+name);
              this._copy(folderstocopy[folder]['id'], finding['id']).catch((e)=>{
              console.log(e); //Will permamently fail here, Needs to be more robust
                })
            } else{
            console.log('creating folder:'+name);

            let SA = this.getSA();
            let res = await SA.files.create({resource:{
              'name' : folderstocopy[folder]['name'],
              'mimeType' : 'application/vnd.google-apps.folder',
              parents: [destination]},
              supportsAllDrives:true,fields: 'id'}).catch((e)=>{
                console.log(e); // Will permamently fail here.
                console.log('failed to create directory, Exiting');
                process.exit(2);
              })
              this._copy(folderstocopy[folder]['id'], res['data']["id"]);
              //if i put await here it will run slower, but if i dont i have to figure out another way to check if done
          }
        }
        this.copies_in_progress -= 1;
  }
  async _drive_file_exist(file, directory){}


  //Needs to have a queue and a ratelimit.
  async _drive_copy(SAI,source,destination){
    let copied_file = await SAI.files.copy({fileId: source,resource:{parents:[destination]},supportsAllDrives:true}).catch((e)=>{
      return false;
    });
    return copied_file;
  }
  async _drive_list_file(SAI,parent){
    let term = " and not mimeType contains 'application/vnd.google-apps.folder'"
    let files = await this._drive_list(SAI,parent,term)
    return files
  }
  async _drive_list_folder(SAI,parent){
    let term = " and mimeType contains 'application/vnd.google-apps.folder'"
    let files = await this._drive_list(SAI,parent,term)
    return files
  }
  async _drive_list(SAI,parent,searchTerms:string=""){
    let file_array = []
    let res = await SAI.files.list({
       pageSize: 1000,
       supportsAllDrives:true,
       includeItemsFromAllDrives:true,
       q:"'"+parent+"' in parents" + searchTerms,
       fields: 'nextPageToken, files(id, name)'
     }).catch((e)=>{console.log(e)});
     if (res.data.files.length) {
         file_array = res.data.files;
     } else {
     }
     if(res.data.nextPageToken){
      let toking = true;
      let pageToken = res.data.nextPageToken;
      while(toking){
        let res = await SAI.files.list({
           pageSize: 1000,
           supportsAllDrives:true,
           includeItemsFromAllDrives:true,
           pageToken:pageToken,
           q:"'"+parent+"' in parents" + searchTerms,
           fields: 'nextPageToken, files(id, name)'
         }).catch((e)=>{console.log(e)});
         if(res.data.files.length) {
             file_array = file_array.concat(res.data.files);
         }
         if(!res.data.nextPageToken){
           toking = false
         }else{pageToken = res.data.nextPageToken}
      }

     }
     return file_array;
  }
}
