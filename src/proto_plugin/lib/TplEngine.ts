import * as LibFs from 'fs';
import * as LibPath from 'path';
import * as handlebars from 'handlebars';

const TPL_BASE_PATH = LibPath.join(__dirname, 'template');

export namespace TplEngine {

    export function render(templateName: string, params: {[key: string]: any}): string {
        return compile(templateName)(params);
    }

    export function compile(templateName: string): HandlebarsTemplateDelegate  {
        return handlebars.compile(
            LibFs.readFileSync(`${LibPath.join(TPL_BASE_PATH, templateName)}.hbs`)
        );
    }

}