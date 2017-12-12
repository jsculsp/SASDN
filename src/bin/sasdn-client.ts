import * as LibFs from 'mz/fs';
import * as program from 'commander';
import * as LibPath from 'path';
import {
    genRpcMethodInfo,
    lcfirst,
    ucfirst,
    mkdir,
    parseMsgNamesFromProto,
    parseProto,
    parseServicesFromProto,
    Proto,
    ProtoFile,
    ProtoParseResult,
    ProtoMsgImportInfos,
    readProtoList,
    RpcMethodInfo,
    RpcProtoServicesInfo,
    RpcProtoClientInfo,
    RpcMethodImportPathInfos,
    addIntoRpcMethodImportPathInfos
} from './lib/lib';
import { TplEngine } from './lib/template';
import { Method as ProtobufMethod, Service as ProtobufService } from 'protobufjs';

const pkg = require('../../package.json');

program.version(pkg.version)
    .option('-i, --import <items>', 'third party proto import path: e.g path1,path2,path3', function list(val) {
        return val.split(',');
    })
    .option('-o, --output <dir>', 'directory to output service codes')
    .option('-e, --exclude <items>', 'files or paths in -p shall be excluded: e.g file1,path1,path2,file2', function list(val) {
        return val.split(',');
    })
    .parse(process.argv);

const IMPORTS = (program as any).import === undefined ? [] : (program as any).import;
const OUTPUT_DIR = (program as any).output === undefined ? undefined : LibPath.normalize((program as any).output);
const EXCLUDES = (program as any).exclude === undefined ? [] : (program as any).exclude;

class ClientCLI {

    private _protoFiles: Array<ProtoFile> = [];

    static instance() {
        return new ClientCLI();
    }

    /**
     * Read import proto and generate DependencyClients
     * Only import proto need a client
     */
    public async run() {
        console.log('ClientCLI start.');
        await this._validate();
        await this._loadProtos();
        await this._genProtoDependencyClients();
    }

    private async _validate() {
        console.log('ClientCLI validate.');

        if (!OUTPUT_DIR) {
            throw new Error('--output is required');
        }

        let outputStat = await LibFs.stat(OUTPUT_DIR);
        if (!outputStat.isDirectory()) {
            throw new Error('--output is not a directory');
        }
    }

    private async _loadProtos() {
        console.log('ClientCLI load proto files.');

        if (IMPORTS.length > 0) {
            for (let i = 0; i < IMPORTS.length; i++) {
                this._protoFiles = this._protoFiles.concat(await readProtoList(LibPath.normalize(IMPORTS[i]), OUTPUT_DIR));
            }
        }
        if (this._protoFiles.length === 0) {
            throw new Error('no proto files found');
        }
    }

    private async _genProtoDependencyClients() {
        console.log('ClientCLI generate clients.');

        let protoServicesInfos = [] as Array<RpcProtoServicesInfo>;
        let protoMsgImportInfos: ProtoMsgImportInfos = {};

        let parseResults = [] as Array<ProtoParseResult>;
        for (let i = 0; i < this._protoFiles.length; i++) {
            let protoFile = this._protoFiles[i];
            if (!protoFile) {
                continue;
            }
            let parseResult = {} as ProtoParseResult;
            parseResult.result = await parseProto(protoFile);
            parseResult.protoFile = protoFile;
            parseResults.push(parseResult);

            let msgImportInfos = parseMsgNamesFromProto(parseResult.result, protoFile);
            Object.assign(protoMsgImportInfos, msgImportInfos);
        }

        await mkdir(LibPath.join(OUTPUT_DIR, 'clients'));

        for (let i = 0; i < parseResults.length; i++) {
            let protoInfo = parseResults[i] as ProtoParseResult;

            let services = parseServicesFromProto(protoInfo.result);
            if (services.length === 0) {
                continue;
            }

            /**
             * Only MS need client & one MS only have one client
             */
            const service = services[0];

            // handle excludes
            let protoFilePath = LibPath.join(protoInfo.protoFile.protoPath, protoInfo.protoFile.relativePath, protoInfo.protoFile.fileName);
            let shallIgnore = false;
            if (EXCLUDES.length > 0) {
                EXCLUDES.forEach((exclude: string) => {
                    if (protoFilePath.indexOf(LibPath.normalize(exclude)) !== -1) {
                        shallIgnore = true;
                    }
                });
            }

            const protoName: string = protoInfo.result.package;
            const ucBaseName: string = ucfirst(protoName);
            let protoClientInfo = {
                protoName: protoName,
                className: `MS${ucBaseName}Client`,
                protoFile: protoInfo.protoFile,
                protoImportPath: Proto.genProtoClientImportPath(protoInfo.protoFile).replace(/\\/g, '/'),
                methodList: {} as Array<RpcMethodInfo>,
            } as RpcProtoClientInfo;
            const outputPath = Proto.genFullOutputClientPath(protoInfo.protoFile);
            let methodInfos = this._genMethodInfos(protoInfo.protoFile, service, outputPath, protoMsgImportInfos, shallIgnore);
            protoClientInfo.clientName = service.name;
            protoClientInfo.methodList = methodInfos;
            let allMethodImportPath: RpcMethodImportPathInfos = {};
            for (const method of protoClientInfo.methodList) {
                for (const key of Object.keys(method.protoMsgImportPath)) {
                    for (const value of method.protoMsgImportPath[key]) {
                        addIntoRpcMethodImportPathInfos(allMethodImportPath, value, key);
                    }
                }
            }
            const importPath = Object.keys(allMethodImportPath)[0];
            protoClientInfo.allMethodImportPath = importPath.replace(/\\/g, '/');
            protoClientInfo.allMethodImportModule = allMethodImportPath[importPath];
            await mkdir(LibPath.dirname(outputPath));
            TplEngine.registerHelper('lcfirst', lcfirst);
            let content = TplEngine.render('rpcs/client', {
                ...protoClientInfo
            });
            await LibFs.writeFile(outputPath, content);
        }
    }

    private _genMethodInfos(protoFile: ProtoFile, service: ProtobufService, outputPath: string, importInfos: ProtoMsgImportInfos, shallIgnore: boolean = false): Array<RpcMethodInfo> {
        console.log('ClientCLI generate method infos: %s', service.name);

        let methodKeys = Object.keys(service.methods);
        if (methodKeys.length === 0) {
            return;
        }

        let methodInfos = [];
        for (const methodKey of methodKeys) {
            const method = service.methods[methodKey];
            const methodInfo = genRpcMethodInfo(protoFile, method, outputPath, importInfos, 'clients');
            console.log('methodInfo = ', methodInfo);
            methodInfos.push(methodInfo);
        }
        return methodInfos;
    }
}

ClientCLI.instance().run().catch((err: Error) => {
    console.log('err: ', err.message);
});