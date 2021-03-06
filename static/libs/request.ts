import { isAbsoluteURL, combineURLs, bind, extend, merge } from "./utils";
import { RequestOptions } from "../type";

type Method = string & RequestOptions["method"];

const methods: Method[] = ["OPTIONS", "GET", "HEAD", "POST", "PUT", "DELETE", "TRACE", "CONNECT"];

export class InterceptorManager {
    protected handlers: Array<{ fulfilled: (res: any) => void, rejected?: (err: UniApp.GeneralCallbackResult) => void } | null>;
    constructor() {
        this.handlers = [];
    }

    public use<T>(fulfilled: (res: T) => void, rejected?: (err: UniApp.GeneralCallbackResult) => void): number {
        this.handlers.push({ fulfilled, rejected });
        return this.handlers.length - 1;
    }

    public eject(id: number): void {
        this.handlers[id] && (this.handlers[id] = null);
    }

    public forEach(fn: (e: { fulfilled: (res: any) => void, rejected?: (err: UniApp.GeneralCallbackResult) => void }) => void): void {
        this.handlers.forEach(e => e && fn(e))
    }
}

class Request {

    [method: string]: any;

    protected interceptors: {
        request: InterceptorManager,
        response: InterceptorManager
    };

    constructor(public defaults: RequestOptions = {}) {
        this.interceptors = {
            request: new InterceptorManager(),
            response: new InterceptorManager()
        };
        methods.forEach((method: Method) => (
            this[method.toLowerCase()] = (
                url: string,
                data: AnyObject,
                options: RequestOptions = {}
            ) => this.request({ ...options, url, data, method })
        ));
    }

    public request(options: RequestOptions) {
        let [chain, promise]: [any[], Promise<any>] = [
            [this.dispatch.bind(this), null],
            Promise.resolve(merge(this.defaults, options))
        ];

        this.interceptors.request.forEach((interceptor: { fulfilled: (res: RequestOptions) => void }) => {
            chain.unshift(interceptor.fulfilled, null);
        });

        this.interceptors.response.forEach((interceptor: {
            fulfilled: (res: UniApp.RequestSuccessCallbackResult) => void,
            rejected?: (err: UniApp.GeneralCallbackResult) => void
        }) => {
            chain.push(interceptor.fulfilled, interceptor.rejected);
        });

        while (chain.length) {
            promise = promise.then(chain.shift(), chain.shift());
        }

        return promise;
    }

    private dispatch(params: RequestOptions) {

        (["success", "fail"] as ("success" | "fail")[]).forEach(item => {
            params[item] && delete params[item];
        });

        if (this.defaults.baseURL && !isAbsoluteURL(params.url!)) {
            params.url = combineURLs(this.defaults.baseURL, params.url!);
        }

        return new Promise((resolve, reject) => {
            const requestTask = uni.request({
                url: params.url!,
                ...params,
                success: res => resolve(res),
                fail: err => reject(err),
                complete(res) { params.complete && params.complete(res) },
            });

            params.timeout && setTimeout(() => {
                requestTask.abort();
                resolve("request timeout");
            }, +params.timeout)
        })
    }
}


export const createInstance = (defaults: RequestOptions): any => {
    const context = new Request(defaults),
        instance = bind(Request.prototype.request, context);

    extend(instance, Request.prototype, context);
    extend(instance, context);

    return instance;
}