/*global window, guid*/
(function (db, describe, it, expect, beforeEach, afterEach) {
    'use strict';
    var key1, key2; // eslint-disable-line no-unused-vars
    describe('bad args', function () {
        this.timeout(5000);
        var indexedDB = window.indexedDB || window.webkitIndexedDB ||
            window.mozIndexedDB || window.oIndexedDB || window.msIndexedDB;

        beforeEach(function (done) {
            this.dbName = guid();
            var req = indexedDB.open(this.dbName);
            req.onsuccess = function () {
                req.result.close();
                done();
            };
            req.onupgradeneeded = function () {
                var objStore = req.result.createObjectStore('names', {autoIncrement: true});
                var person1 = {name: 'Alex'};
                var person2 = {name: 'Mia'};

                var addReq1 = objStore.add(person1);
                addReq1.onsuccess = function (e) {
                    key1 = e.target.result;
                    var addReq2 = objStore.add(person2);
                    addReq2.onsuccess = function (e2) {
                        key2 = e2.target.result;
                    };
                };
            };
            req.onerror = function (e) {
                console.log('error: ' + e);
            };
            req.onblocked = function (e) {
                console.log('blocked: ' + e);
            };
        });

        afterEach(function () {
            if (this.server && !this.server.isClosed()) {
                this.server.close();
            }
            this.server = undefined;

            indexedDB.deleteDatabase(this.dbName);
        });

        describe('open', function () {
            it('should catch throwing schema arg', function (done) {
                db.open({server: this.dbName, schema: function () {
                    throw new Error('Bad schema');
                }}).catch(function (err) {
                    expect(err.message).to.equal('Bad schema');
                    done();
                });
            });
            it('should catch an attempt to (auto-load) a schema with a conflicting name (when there is no noServerMethods)', function (done) {
                var spec = this;
                var req = indexedDB.open(this.dbName, 2);
                req.onsuccess = function () {
                    req.result.close();
                    db.open({server: spec.dbName, version: 2}).catch(function (err) {
                        expect(err.message).to.have.string('conflicts with db.js method names');
                        done();
                    });
                };
                req.onupgradeneeded = function () {
                    var storeNameConflictingWithMethod = 'count';
                    req.result.createObjectStore(storeNameConflictingWithMethod);
                };
            });
            it('should treat version 0 as 1 being supplied (if db.js did not, it should throw an error)', function (done) {
                db.open({server: this.dbName, version: 0}).then(function (s) {
                    expect(s).to.be.defined;
                    s.close();
                    done();
                });
            });
        });

        describe('open: createSchema', function () {
            it('should catch bad key paths', function (done) {
                db.open({server: this.dbName, version: 2, schema: {
                    test: {
                        key: {
                            keyPath: 55
                        }
                    }
                }}).catch(function (err) {
                    expect(err.name).to.equal('SyntaxError');
                    done();
                });
            });
            it('should catch autoIncrement with empty key path string', function (done) {
                db.open({server: this.dbName, version: 2, schema: {
                    test: {
                        key: {
                            autoIncrement: true,
                            keyPath: ''
                        }
                    }
                }}).catch(function (err) {
                    expect(err.name).to.equal('InvalidAccessError');
                    done();
                });
            });
            it('should catch bad key path for indexes', function (done) {
                db.open({server: this.dbName, version: 2, schema: {
                    test: {
                        indexes: {
                            index1: {
                                keyPath: 55
                            }
                        }
                    }
                }}).catch(function (err) {
                    expect(err.name).to.equal('SyntaxError');
                    done();
                });
            });
            it('should catch bad multiEntry key path for indexes', function (done) {
                db.open({server: this.dbName, version: 2, schema: {
                    test: {
                        indexes: {
                            index1: {
                                multiEntry: true,
                                keyPath: ['']
                            }
                        }
                    }
                }}).catch(function (err) {
                    expect(err.name).to.equal('InvalidAccessError');
                    done();
                });
            });
        });

        describe('Server', function () {
            it('should catch addEventListener/removeEventListener errors', function (done) {
                db.open({server: this.dbName}).then(function (s) {
                    try {
                        s.addEventListener('badEvent', function () {});
                    } catch (err) {
                        expect(err.message).to.have.string('Unrecognized event type');
                    }
                    try {
                        s.removeEventListener('badEvent', function () {});
                    } catch (err) {
                        expect(err.message).to.have.string('Unrecognized event type');
                        s.close();
                        done();
                    }
                });
            });
            it('should catch Server errors related to connection already being closed', function (done) {
                db.open({server: this.dbName}).then(function (s) {
                    s.close();
                    ['count', 'get', 'close', 'clear', 'remove', 'delete', 'update', 'put', 'add', 'query'].reduce(function (promise, method) {
                        return promise.catch(function (err) {
                            expect(err.message).to.equal('Database has been closed');
                            return s[method]();
                        });
                    }, Promise.reject(new Error('Database has been closed')))
                    .then(function (queryResult) {
                        queryResult.all().execute().catch(function (err) {
                            expect(err.message).to.equal('Database has been closed');
                            done();
                        });
                    });
                });
            });
            it('should catch bad range keys', function (done) {
                db.open({server: this.dbName}).then(function (s) {
                    s.names.get({badKey: ''}).catch(function (err) {
                        expect(err.message).to.have.string('are conflicted keys');
                        return s.names.count({badKey: ''});
                    }).catch(function (err) {
                        expect(err.message).to.have.string('are conflicted keys');
                        return s.names.query().range({badKey: ''}).execute();
                    }).catch(function (err) {
                        expect(err.message).to.have.string('is not valid key');
                        return s.names.query().only(null).execute();
                    }).catch(function (err) {
                        expect(err.name).to.have.string('DataError');
                        s.close();
                        done();
                    });
                });
            });
            it('Bad store names (to db.transaction)', function (done) {
                var nonexistentStore = 'nonexistentStore';
                db.open({server: this.dbName}).then(function (s) {
                    var item = {
                        firstName: 'Aaron',
                        lastName: 'Powell'
                    };
                    s.add(nonexistentStore, item).catch(function (err) {
                        expect(err.name).to.equal('NotFoundError');
                        return s.update(nonexistentStore, {firstName: 'Alex', lastName: 'Zamir'});
                    }).catch(function (err) {
                        expect(err.name).to.equal('NotFoundError');
                        return s.remove(nonexistentStore, 1);
                    }).catch(function (err) {
                        expect(err.name).to.equal('NotFoundError');
                        return s.clear(nonexistentStore);
                    }).catch(function (err) {
                        expect(err.name).to.equal('NotFoundError');
                        return s.get(nonexistentStore, 1);
                    }).catch(function (err) {
                        expect(err.name).to.equal('NotFoundError');
                        return s.count(nonexistentStore);
                    }).catch(function (err) {
                        expect(err.name).to.equal('NotFoundError');
                        return s.query(nonexistentStore).all().execute();
                    }).catch(function (err) {
                        expect(err.name).to.equal('NotFoundError');
                        done();
                    });
                });
            });
        });

        describe('query', function () {
            it('should catch a bad modify object method', function (done) {
                db.open({server: this.dbName}).then(function (s) {
                    s.names.query().all().modify({
                        key1: function () {
                            throw new Error('Problem modifying');
                        }
                    }).execute().catch(function (err) {
                        expect(err.message).to.equal('Problem modifying');
                        s.close();
                        done();
                    });
                });
            });
            it('should catch a bad map function', function (done) {
                db.open({server: this.dbName}).then(function (s) {
                    s.names.query().all().map(function () {
                        throw new Error('Problem mapping');
                    }).execute().catch(function (err) {
                        expect(err.message).to.equal('Problem mapping');
                        s.close();
                        done();
                    });
                });
            });
        });

        describe('delete', function () {
            it('should catch bad args', function (done) {
                var spec = this;
                var caught = false;
                db.open({server: this.dbName}).then(function (s) {
                    db.delete(spec.dbName).catch(function (err) { // Other arguments (or missing arguments) do not throw
                        expect(err.type).to.equal('blocked');
                        s.close();
                        caught = true;
                        return err.resume;
                    }).then(function () {
                        expect(caught).to.be.true;
                        done();
                    });
                });
            });
        });

        describe('cmp', function () {
            it('cmp: should catch bad args', function (done) {
                db.cmp(key1, null).catch(function (err) {
                    expect(err.name).to.equal('DataError');
                    done();
                });
            });
        });
    });
}(window.db, window.describe, window.it, window.expect, window.beforeEach, window.afterEach));
