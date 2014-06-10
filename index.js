'use strict';

var mongodb = require('mongodb');
var _ = require('lodash');



var defaults = {
    collection: 'captcha',
};




function QuietCaptcha(options, callback) {
    options = _.extend(defaults, options);

    // an instantiated DB object has a `serverConfig` object
    if (typeof options.db === 'object' && options.db.serverConfig) {
        this.db = options.db;
    } else {
        throw new Error('QuietCaptcha: Required option `db` (a fully instantiated Db object) is missing');
    }

    this.collection_name = options.collection;
    this.maxPerDay = options.maxPerDay;
    this.quietTime = options.quietTime;
}


QuietCaptcha.prototype._get_collection = function(callback) {
    var self = this;
    if (self.collection) {
        callback && callback(self.collection);
    } else if (self.db.openCalled) {
        self.db.collection(self.collection_name, function(err, collection) {
            if (err) {
                throw new Error('QuietCaptcha: Error getting collection: ' + self.collection_name + ": " + String(err));
            } else {
                self.collection = collection;
                callback && callback(collection);
            }
        });
    } else {
        self._open_database(callback);
    }
};

QuietCaptcha.prototype._open_database = function(callback) {
    var self = this;
    self.db.open(function(err, db) {
        if (err) {
            throw new Error('QuietCaptcha: Error opening database');
        }
        self._get_collection(callback);
    });
};


QuietCaptcha.prototype.get = function(ip, callback) {
    this._get_collection(function(collection) {
        collection.find({ip: ip}).sort({timestamp: -1}, function(err, cursor) {
            if (err) {
                callback && callback(err);
            } else {
                cursor.toArray(function(err, hits) {
                    if (err) {
                        callback && callback(err);
                    } else {
                        var now = new Date();
                        var count = hits.length;
                        var sinceLast = (count) ? now.getTime() - hits[0].timestamp.getTime(): -1;
                        callback && callback(null, {
                            count: count,
                            sinceLast: sinceLast,
                            items: hits
                        });
                    }
                });
            }
        });
    });
};

QuietCaptcha.prototype.set = function(ip, callback) {
    var d = {ip: ip, timestamp: new Date() };

    this._get_collection(function(collection) {
        collection.insert(d, function(err, data) {
            if (err) {
                callback && callback(err);
            } else {
                callback && callback(null);
            }
        });
    });
};

QuietCaptcha.prototype.clear = function(ip, callback) {
    var self = this;
    var q = {};
    if (ip) {
        q = {ip: ip};
    }

    self._get_collection(function(collection) {
        collection.remove(q, function(err) {
            callback && callback(err);
        });
    });
};


QuietCaptcha.prototype.filter = function() {
    // We return a function here so that we don't lose binding
    var self = this;
    return function(req, res, next) {
        var now = new Date().getTime();

        self.get(req.ip, function(err, hits) {
            req.quietCaptcha = {hits: hits};

            // Maximum number of hits per day
            if (self.maxPerDay) {
                var recent = _.filter(hits.items, function(hit) {
                    return now - hit.timestamp.getTime() <= 86400000;
                });

                if (recent.length >= self.maxPerDay) {
                    req.quietCaptcha.error = "Exceeded Max Per Day";
                    return next();
                }
            }

            // Check frequency
            if (self.quietTime) {
                console.log("freq:", hits.sinceLast, self.quietTime);
                if (hits.sinceLast < self.quietTime) {
                    req.quietCaptcha.error = "Submitted too frequently";
                    return next();
                }
            }

            console.log("QC filter: ", hits.count);
            self.set(req.ip);
            next();
        });
    };
};
    
module.exports = exports = QuietCaptcha;
