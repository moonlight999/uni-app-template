import Vue from "vue";
import { pageData, sleep, Storage, transformQueryString } from './libs/utils';
import { createInstance } from "./libs/request";
import { Response, RequestOptions, RequestInstance } from './type';
import config from "./config.json";

const { beta, release, path, page, authorizationValidityDay } = config,
    currentEnv: AnyObject = process.env.NODE_ENV === 'development' ? beta : release,
    [API_URL, SOCKET_URL]: [string, string] = [`${currentEnv.http}${path.api || ""}`, `${currentEnv.socket}${path.socket || ""}`];

export const $config = Object.assign(config, { currentEnv, API_URL, SOCKET_URL });

export const $request: RequestInstance<Response> = createInstance({
    baseURL: API_URL,
    dataType: "json",
    header: {
        "Content-type": "application/x-www-form-urlencoded"
    },
    responseType: "text"
});

const pretreatment: AnyObject = {
    throttle: false,
    times: 0,
    codeHandler: {
        notAuth: async ({ msg: title }: Response): Promise<string | void> => {
            if (pretreatment.throttle) return;
            pretreatment.throttle = true;

            if (page.authorization) {
                await uni.showToast({ title, icon: "none", duration: 1200 });
                pretreatment.throttle = true;
                await sleep(1.2)
                await uni.reLaunch({ url: page.authorization, success: Storage.clear });
                pretreatment.throttle = false;

                return Promise.reject(title);
            }

            const [loginFail, loginRes]: any = await uni.login({});
            if (loginFail) {
                uni.showToast({ title: loginFail.errMsg, icon: "none" });
                return Promise.reject(loginFail.errMsg);
            }

            const [reqFail, result]: any = await uni.request({
                url: `${API_URL}${path.login}`,
                data: { code: loginRes.code }
            });

            if (reqFail) {
                uni.showToast({ title: reqFail.errMsg, icon: "none" });
                return;
            }
            const { code, data, msg } = result.data;
            if (!+code) {
                uni.showToast({ title: msg, icon: "none" });
                return;
            }
            Storage.set("authorizationInfo", data, authorizationValidityDay);

            if (++pretreatment.times >= 3) {
                const [, modal]: any = await uni.showModal({
                    title: "Prompt",
                    content: "Multiple redirects detected, Whether to continue?",
                    confirmText: "Continue",
                    cancelText: "Cancel"
                });
                if (modal.cancel) return;
            }
            pretreatment.times = 0;
            pretreatment.throttle = false;
            const { route, options }: any = pageData(-1);
            uni.reLaunch({ url: `/${route}?${transformQueryString(options)}` });
            return Promise.reject(title);
        },

        fail: (res: Response) => {
            uni.showToast({ title: res.msg, icon: "none" });
            return Promise.reject(res)
        },

        error: (res: Response) => Promise.reject(res),

        success: (res: Response) => Promise.resolve(res),
    }
}

$request.interceptors.request.use<RequestOptions>(
    params => {
        params.data ?? (params.data = {});

        const authorizationInfo = Storage.get("authorizationInfo");
        authorizationInfo && (params.header.token = authorizationInfo.token);

        if (typeof params.data === "object") {
            for (const key in params.data) {
                if ([undefined, null, NaN].includes(params.data && params.data[key])) {
                    delete params?.data[key];
                }
            }
        }

        return params;
    }
);

$request.interceptors.response.use<UniApp.RequestSuccessCallbackResult>(
    res => {
        const result = <Response | string>res.data;

        try {
            if (typeof (result) === "object") {
                const { success, notAuth, fail, error } = pretreatment.codeHandler;
                switch (+result.code) {
                    case 0: // 失败
                        return fail(result);
                    case 1: // 成功
                        return success(result);
                    case 401: // 未授权
                        return notAuth(result);
                    default: // 错误
                        return error(result);
                }
            }
            uni.showModal({
                title: "Error Message",
                content: <string>result,
                confirmText: "Copy",
                cancelText: "Cancel",
                success: ({ confirm }) =>
                    confirm && uni.setClipboardData({
                        data: <string>result,
                        success: () => uni.showToast({ title: "Copied" })
                    })
            });
            return Promise.reject(result);
        } catch ({ message: title }) {
            uni.showToast({ title, icon: "none" });
            return Promise.reject(title);
        } finally {
            console.warn(`Response:`, res);
        }
    },
    err => {
        uni.showToast({ title: err.errMsg, icon: "none" })
        return Promise.reject(err)
    }
);

Vue.prototype.$config = $config;
Vue.prototype.$request = $request;
