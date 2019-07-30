//This will be a test implementation of libfolderclone
import {LibFolderClone} from "./libfolderclone"

var folderclone = new LibFolderClone({"basepath":__dirname});
async function boot(){
  await folderclone.isReady().catch((e)=>{console.log(e)});
//  folderclone.run(input,output);
}
boot();
