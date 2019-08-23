const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const cheerio = require('cheerio');
const request = require('request');
const archiver = require('archiver');
const bodyParser = require("body-parser");
const cookieParser = require('cookie-parser');
const setCookie = require('set-cookie-parser');

var UserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.14; rv:68.0) Gecko/20100101 Firefox/68.0';
const app = express();
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
const PORT = process.env.PORT || 5000;

/*
* Cookie: __cfduid, csrftoken, sessionid
*/
app.listen(PORT, () => console.log(`Listening on ${PORT}`));

app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname, 'index.html'));
})
app.get('/favorites', function(req, res, next) {
    const cookies = req.cookies;
    var page = 1;
    if (req.query.page)
        page = req.query.page;
    if (cookies.session && cookies.cfduid && cookies.token) {
        var url = `https://nhentai.net/favorites/?page=${page}`;
        if (req.query.q)
            url += `&q=${req.query.q}`;
        get_page(url, cookies.cfduid, cookies.token, cookies.session, function(err, resp, body) {
            if (resp.statusCode !== 200 || body.indexOf('<div class=\"row\"><input type=\"text\" name=\"username_or_email\"') !== -1) {
                res.clearCookie('session');
                res.redirect('/login');
                return;
            }
            body = process_html(body);
            res.write(body);
            res.end();
            // console.log(body);
        });

    }else {
        res.redirect('/login');
        return;
    }
    // res.sendFile(path.join(__dirname, 'favorite', 'index.html'));
})
app.get('/search', function(req, res, next) {
    const cookies = req.cookies;
    var url = `https://nhentai.net/search/?q=${req.query.q}`;
    if (req.query.sort)
        url += `&sort=${req.query.sort}`;
    get_page(url, 0, 0, 0, function(err, resp, body) {
        if (resp.statusCode !== 200) {
            next();
            return;
        }
        body = process_html(body);
        res.write(body);
        res.end();
    });
})
app.get('/login', function(req, res, next) {
    res.sendFile(path.join(__dirname, 'login', 'index.html'));
})
app.post('/login', function(req, res, next) {
    login(req.body.user, req.body.password, async function (cfduid, token, session) {
        if (cfduid === -1) {
            var html = await fs.readFileSync(path.join(__dirname, 'login', 'index.html')).toString();
            html = add_string(html, '<div style=\"text-align: center;\">', 'Login Failed!');
            res.write(html);
            res.end();
            return;
        }
        console.log("Success");
        var today = new Date();
        var expire = new Date();
        expire.setDate(today.getDate() + 100);
        res.cookie('cfduid', cfduid,{ expires: expire});
        res.cookie('token', token,{ expires: expire});
        res.cookie('session', session,{ expires: expire, httpOnly: true});
        res.redirect('/favorites');
    })
})
app.get('/logout', function(req, res, next) {
    res.clearCookie('session');
    res.redirect('/');
})
app.get('/query', function(req, res, next) {
    if (req.query.number === undefined) {
        next();
        return;
    }
    var num = req.query.number;
    const $ = cheerio.load(fs.readFileSync(path.join('query', 'index.html')).toString());
    get_title(num, async function(title, url, pages, num) {
        if (pages === -1) {
            next();
            return;
        }
        console.log(`Query: ${num}`);
        $('.output').text(`${num}`);
        $('.output2').text(`${title} (${pages}p)`);
        var html = $.html();
        // Url redirect
        html = add_string(html, '\"button\" id=\"button\" onclick=\"', `window.location = \`/download/?title=${title}&url=${url}&pages=${pages}&number=${num}`);

        // Min & Max
        html = add_string(html, 'placeholder=\"Start page\"', ` min=\"1\" max=\"${pages}\"`);
        html = add_string(html, 'placeholder=\"End page\"'  , ` min=\"1\" max=\"${pages}\"`);

        res.write(html);
        res.end();
    })
})

app.get('/download', async function(req, res, next) {
    var title = req.query.title;
    var url = req.query.url;
    var pages = req.query.pages;
    var num = req.query.number;
    var start = req.query.start;
    var end = req.query.end;

    if (!(title && url && pages && num)) {
        console.log('error');
        next();
        return;
    }
    start = parseInt(start); end = parseInt(end);
    if (!Number.isInteger(start)) start = 1;
    if (!Number.isInteger(end)) end = pages;
    if (start > end)
        end = start;
    res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-disposition': `attachment; filename=${num}.zip`
    });
    var zip = archiver('zip', {
        store: true
    });
    zip.pipe(res);
    // zip.append(`${title}(${num})`, {name: 'title.txt'});

    console.log(start + ' ' + end);
    var now = start;
    finish = end - start + 1;
    while (now <= end) {
        download_photo(`https://i.nhentai.net/galleries/${url}/${now}.`, now, 0, function(url, name, type, cnt) {
            if (cnt <= 4) {
                var stream = request(url + type);
                zip.append(stream, {name: path.join(`${title}(${num})`, `${name}.${type}`)});
            }
            if (--finish === 0)
                zip.finalize();
        });
        now++;
        await sleep(100);
    }
})
app.get('*css', function(req, res) {
    filename = path.join(__dirname, path.normalize(req.originalUrl));
    if (filename[filename.length - 1] === '/') {
        next();
        return;
    }
    fs.access(filename, fs.F_OK, (err) => {
        if (err) {
            next();
            return;
        }
        res.sendFile(filename);
    })
})
app.get('/404/*', function (req, res, next) {
    filename = path.join(__dirname, path.normalize(req.originalUrl));
    if (filename[filename.length - 1] === '/') {
        next();
        return;
    }
    fs.access(filename, fs.F_OK, (err) => {
        if (err) {
            next();
            return;
        }
        res.sendFile(filename);
    })
    
})
app.all('*', function(req, res, next) {
    res.sendFile(path.join(__dirname, '404', '404.html'));
});


function sleep(ms){
    return new Promise(resolve => {
        setTimeout(resolve, ms)
    })
}
function get_title(val, callback) {
    if (isNaN(val = val.substr(0, 6))) {
        callback('Error');
        resolve(0);
    }
    request({url: `https://nhentai.net/g/${val}`}, async function(error, response, body) {
        if (error || response.statusCode !== 200) {
            callback(0, 0, -1, 0);
            return;
        }
        //get url
        var keyword = '<meta itemprop=\"image\" content=\"https://t.nhentai.net/galleries/';
        var index = body.indexOf(keyword) + keyword.length;
        var url = '', cnt = '', title = '';
        while (body[index] != '/')
            url += body[index++];
        //get pages
        index = body.indexOf(' pages</div>');
        while (body[index - 1] != '>')
            index--;
        while (body[index] != ' ')
            cnt += body[index++];
        finish = cnt = parseInt(cnt, 10);
        //get title
        keyword = '<h2>';
        index = body.indexOf(keyword) + keyword.length;
        while (body[index] != '<' || body[index + 1] != '/' || body[index + 2] != 'h')
            title += body[index++];
        callback(title, url, cnt, val);
    });
}
async function download_photo(url, filename, cnt, callback) {
    if (cnt > 4) {
        callback(0, 0, 0, cnt);
        return;
    }
    if (cnt > 0)
        await sleep(200);
    url_exist(url + 'jpg', function(exist) {
        if (exist)
            callback(url, filename, 'jpg', cnt);
        else {
            url_exist(url + 'png', function(exist) {
                if (exist)
                    callback(url, filename, 'png', cnt);
                else {
                    download_photo(url, filename, cnt + 1, callback);
                }
            })
        }
    })
}
function url_exist(url, callback) {
    var options = {
        method: 'HEAD',
        url: url
    };
    request(options, function (err, resp, body) {
        if (err)
            console.log(err);
        callback(!err && resp.statusCode == 200);
    });
}
function add_string(text, keyword, add) {
    var index = text.indexOf(keyword);
    if (index === -1) {
        return text;
    }else index += keyword.length;
    return text.slice(0, index) + add + text.slice(index);
}
function login(username, pass, callback) {
    request.get({url: 'https://nhentai.net/login/', headers: {'User-Agent': UserAgent}}, function(error, response, body) {
        var token = '';
        var keyword = 'name=\"csrfmiddlewaretoken\" value=\"';
        var index = body.indexOf(keyword) + keyword.length;
        while (body[index + 1] != '>')
            token += body[index++];
        var cookies = setCookie.parse(response.headers['set-cookie'], {
            decodeValues: true,
            map: true
        });
        var cfduid = cookies.__cfduid.value;
        var options = {
            url: 'https://nhentai.net/login/',
            headers: {
                'Host': 'nhentai.net',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': 'en-US,en;q=0.5',
                'User-Agent': UserAgent,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': 'https://nhentai.net/login/',
                'DNT': '1',
                'Cookie': `__cfduid=${cfduid}; csrftoken=${cookies.csrftoken.value}`,
                'Connection': 'keep-alive'
            },
            form: {
                'csrfmiddlewaretoken': token,
                'username_or_email': username,
                'password': pass
            }
        }
        request.post(options, async function(error, response, body) {
            var cookies = setCookie.parse(response.headers['set-cookie'], {
                decodeValues: true,
                map: true
            });
            // console.log(body);
            if (cookies.sessionid === undefined) {
                callback(-1);
                return;
            }
            callback(cfduid, cookies.csrftoken.value, cookies.sessionid.value);
            // var headers = {
            //     'User-Agent': UserAgent,
            //     'Cookie': `__cfduid=${cfduid}; csrftoken=${cookies.csrftoken.value}; sessionid=${cookies.sessionid.value}`,
            // };
        });
    })
}
function get_page(url, cfduid, token, session, callback) {
    if (cfduid !== 0)
        var headers = {
            'User-Agent': UserAgent,
            'Cookie': `__cfduid=${cfduid}; csrftoken=${token}; sessionid=${session}`,
        };
    else
        var headers = {'User-Agent': UserAgent};
    request({url: url, headers: headers}, callback);
}
function process_html(body) {
    body = body.replace(/\/g\//g, '/query/?number=');
    body = body.replace(/<button class="btn btn-primary btn-thin remove-button" type="button">\n\t*<i class="fa fa-minus"><\/i> <span class="text">Remove<\/span>\n\t*<\/button>/g, '');

    keyword = '><i class=\"fa fa-tachometer\"></i> ';
    var index = body.indexOf(keyword) + keyword.length;
    var username = '';
    while (body[index] !== '<')
        username += body[index++];
    // console.log(username);
    body = body.replace(/<a href=\"\/users\/.*fa fa-tachometer.*<\/a><\/li><li>/g, '<i class=\"fa fa-tachometer\"></i> ' + username + '</li><li>');
    body = body.replace(/<ul class=\"menu left\">.*Info<\/a><\/li><\/ul>/, '');
    body = body.replace(/<a href="\/favorites\/random".*class="fa fa-random fa-lg"><\/i><\/a>/, '');
    // body = body.replace(/<form role="search".*<\/button><\/form>/, '');
    body = add_string(body, '<head>', '<meta name="referrer" content="no-referrer">');
    return body;
}



