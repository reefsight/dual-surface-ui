const childUrl = new URL(location.href);
childUrl.port = String(Number(childUrl.port) + 1);
childUrl.pathname = "/examples/browser-evidence/native-frame-child.html";
childUrl.hash = "";

childUrl.search = "?permission=blocked";
document.querySelector("#blocked-child").src = childUrl.href;
childUrl.search = "?permission=delegated";
document.querySelector("#delegated-child").src = childUrl.href;
