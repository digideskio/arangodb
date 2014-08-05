/*jslint indent: 2, nomen: true, maxlen: 120, sloppy: true, vars: true, white: true, plusplus: true */
/*global require, exports, ArangoClusterInfo, ArangoServerState*/

////////////////////////////////////////////////////////////////////////////////
/// @brief Pregel module. Offers all submodules of pregel.
///
/// @file
///
/// DISCLAIMER
///
/// Copyright 2010-2014 triagens GmbH, Cologne, Germany
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///
/// Copyright holder is triAGENS GmbH, Cologne, Germany
///
/// @author Florian Bartels, Michael Hackstein, Guido Schwab
/// @author Copyright 2011-2014, triAGENS GmbH, Cologne, Germany
////////////////////////////////////////////////////////////////////////////////

var db = require("internal").db;
var _ = require("underscore");
var arangodb = require("org/arangodb");
var ERRORS = arangodb.errors;
var ArangoError = arangodb.ArangoError;

exports.getServerName = function () {
  return ArangoServerState.id() || "localhost";
};

exports.genWorkCollectionName = function (executionNumber) {
  return "P_work_" + executionNumber;
};

exports.genMsgCollectionName = function (executionNumber) {
  return "P_messages_" + executionNumber;
};

exports.genGlobalCollectionName = function (executionNumber) {
  return "P_global_" + executionNumber;
};

exports.getWorkCollection = function (executionNumber) {
  return db._collection(exports.genWorkCollectionName(executionNumber));
};

exports.getTimeoutConst = function (executionNumber) {
  return 300000;
};

exports.getMsgCollection = function (executionNumber) {
  return db._collection(exports.genMsgCollectionName(executionNumber));
};

exports.getOriginalCollection = function (id, executionNumber) {
  var mapping = exports.getGlobalCollection(executionNumber).document("map").map;
  var collectionName = exports.getResultCollection(id), originalCollectionName;

  _.each(mapping, function(value, key) {
    if (value.resultCollection === collectionName) {
      originalCollectionName = key;
    }
  });

  if (originalCollectionName === undefined) {
    return collectionName;
  }
  return originalCollectionName;
};

exports.getLocationObject = function (executionNumber, collection, vertex) {
  var map = exports.getMap(executionNumber);
  var correct;
  if (map[collection]) {
    correct = map[collection];
  } else {
    correct = _.findWhere(map, {resultCollection: collection});
  }
  var keys = correct.shardKeys;
  var i;
  var obj = {};
  for (i = 0; i < keys.length; i++) {
    obj[keys[i]] = vertex["shard_" + i];
  }
  return obj;
};

exports.getFromLocationObject = function (executionNumber, edge) {
  var map = exports.getMap(executionNumber);
  var fromCol = edge._from.split("/")[0];
  var correct;
  if (map[fromCol]) {
    correct = map[fromCol];
  } else {
    correct = _.findWhere(map, {resultCollection: fromCol});
  }
  var keys = correct.shardKeys;
  var i;
  var obj = {};
  for (i = 0; i < keys.length; i++) {
    obj[keys[i]] = edge["from_shard_" + i];
  }
  return obj;
};

exports.getToLocationObject = function (executionNumber, edge) {
  var map = exports.getMap(executionNumber);
  var toCol = edge._to.split("/")[0];
  var correct;
  if (map[toCol]) {
    correct = map[toCol];
  } else {
    correct = _.findWhere(map, {resultCollection: toCol});
  }
  var keys = correct.shardKeys;
  var i;
  var obj = {};
  for (i = 0; i < keys.length; i++) {
    obj[keys[i]] = edge["to_shard_" + i];
  }
  return obj;
};

exports.getResultCollection = function (id) {
  return id.split('/')[0];
};

exports.getGlobalCollection = function (executionNumber) {
  return db._collection(exports.genGlobalCollectionName(executionNumber));
};

exports.getMap = function (executionNumber) {
  return exports.getGlobalCollection(executionNumber).document("map").map;
};

exports.getResponsibleShardFromMapping = function (executionNumber, resShard) {
  var map = exports.getMap(executionNumber);
  var correct = _.filter(map, function (e) {
    return e.resultShards[resShard] !== undefined;
  })[0];
  var resultList = Object.keys(correct.resultShards);
  var index = resultList.indexOf(resShard);
  var originalList = Object.keys(correct.originalShards);
  return originalList[index];
};


exports.getResponsibleShard = function (col, doc) {
  if (ArangoServerState.role() === "PRIMARY") {
    var colId = ArangoClusterInfo.getCollectionInfo(db._name(), col).id;
    var res = ArangoClusterInfo.getResponsibleShard(colId, doc).shardId;
    return res;
  }
  return col;
};

exports.getShardKeysForCollection = function (executionNumber, collection) {
  var globalCol = exports.getGlobalCollection(executionNumber);
  var map = globalCol.document("map").map;
  if (!map[collection]) {
    var err = new ArangoError();
    err.errorNum = ERRORS.ERROR_PREGEL_INVALID_TARGET_VERTEX.code;
    err.errorMessage = ERRORS.ERROR_PREGEL_INVALID_TARGET_VERTEX.message;
    throw err;
  }
  return map[collection].shardKeys;
};

exports.getResponsibleEdgeShards = function (executionNumber, vertex) {
  var doc = vertex._id;
  var col = doc.split("/")[0];
  var key = doc.split("/")[1];
  var map = exports.getMap(executionNumber);
  var example = {
    taiwanese: key
  };
  var result = [];
  if(map[col] !== undefined) {
    if (ArangoServerState.role() === "PRIMARY") {
      _.each(map, function (c, key) {
        if (c.type === 3) {
          result.push(exports.getResponsibleShard(key, example));
        }
      });
      return result;
    }
    _.each(map, function (c, key) {
      if (c.type === 3) {
        result.push(key);
      }
    });
    return result;
  }
  if (ArangoServerState.role() === "PRIMARY") {
    _.each(map, function (c, col) {
      if (c.type === 3) {
        result.push(exports.getResponsibleShard(col, example));
      }
    });
    return result;
  }
  _.each(map, function (c, col) {
    if (c.type === 3) {
      result.push(col);
    }
  });
  return result;
};

exports.Conductor = require("org/arangodb/pregel/conductor");
exports.Worker = require("org/arangodb/pregel/worker");
exports.Vertex = require("org/arangodb/pregel/vertex").Vertex;
exports.Edge = require("org/arangodb/pregel/edge").Edge;
exports.MessageQueue = require("org/arangodb/pregel/messagequeue").MessageQueue;
