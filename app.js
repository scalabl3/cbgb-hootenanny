angular.module('cbgb', []).
  config(['$routeProvider', function($routeProvider) {
  $routeProvider.
      when('/server',
           {templateUrl: 'partials/server.html',
            controller: ServerCtrl}).
      when('/buckets',
           {templateUrl: 'partials/buckets.html',
            controller: BucketsCtrl}).
      when('/buckets/:bucketName',
           {templateUrl: 'partials/bucket.html',
            controller: BucketCtrl}).
      when('/buckets/:bucketName/ddocs',
           {templateUrl: 'partials/bucket-ddocs.html',
            controller: BucketDDocsCtrl}).
      when('/buckets/:bucketName/_design/:ddocNameSuffix',
           {templateUrl: 'partials/bucket-ddoc.html',
            controller: BucketDDocCtrl}).
      when('/buckets/:bucketName/stats',
           {templateUrl: 'partials/bucket-stats.html',
            controller: BucketStatsCtrl}).
      otherwise({redirectTo: '/buckets'});
}]).run(function($rootScope, $location) {
        $rootScope.location = $location;
    });
// ^^ Had to assign rootScope.location to make $location available, which allows use of location.hostname and location.port TODO: load port config from cbgb since that can vary, defaults to 8092 now
var restErrorMsg = "error communicating with server; please try again.";

var bucketNamePattern = /^[A-Za-z0-9\-_]+$/;
var ddocNamePattern = /^[A-Za-z0-9\-_\/]+$/;
var viewNamePattern = /^[A-Za-z0-9\-_]+$/;

function ServerCtrl($scope, $http) {
  $scope.serverGC = function() {
    $http.post("/_api/runtime/gc").
      success(function() {
          alert("Server GC succeeded");
      }).
      error(function(data) {
          alert("Server GC failed");
      });
  };

  $http.get('/_api/settings').
    success(function(data) {
      $scope.settings = data;
      $scope.err = null;
    }).
    error(function() {
        $scope.err = restErrorMsg;
    });
  $http.get('/_api/runtime').
    success(function(data) {
      $scope.runtime = data;
      $scope.err = null;
    }).
    error(function() {
        $scope.err = restErrorMsg;
    });
  $http.get('/_api/runtime/memStats').
    success(function(data) {
      $scope.runtimeMemStats = data;
      $scope.err = null;
    }).
    error(function() {
        $scope.err = restErrorMsg;
    });
}

function BucketsCtrl($scope, $http) {
  $scope.bucketName = "";
  $scope.bucketPassword = "";
  $scope.bucketQuotaBytes = 1000000;
  $scope.bucketMemoryOnly = 0;

  $scope.bucketCreate = function() {
    var bucketName = $scope.bucketName;
    if (bucketName.length <= 0) {
        return;
    }
    if (!bucketName.match(bucketNamePattern)) {
      $scope.bucketCreateResult =
        "error: please use alphanumerics, dashes, and underscores only";
        return;
    }
    if (_.contains($scope.names, bucketName)) {
      $scope.bucketCreateResult =
        "error: bucket " + bucketName + " already exists";
        return;
    }

    $scope.bucketCreateResult = "creating bucket: " + bucketName + " ...";
    $http({
        method: 'POST',
        url: '/_api/buckets',
        data: 'name=' + encodeURIComponent(bucketName) +
          '&password=' + encodeURIComponent($scope.bucketPassword) +
          '&quotaBytes=' + encodeURIComponent($scope.bucketQuotaBytes) +
          '&memoryOnly=' + encodeURIComponent($scope.bucketMemoryOnly),
        headers: {'Content-Type': 'application/x-www-form-urlencoded'}
      }).
      success(function(data) {
        $scope.bucketCreateResult = "created bucket: " + bucketName;
        retrieveBucketNames();
      }).
      error(function(data) {
        $scope.bucketCreateResult =
          "error creating bucket: " + bucketName + "; error: " + data;
      });
  };

  $scope.bucketsRescan = function() {
    $http.post("/_api/bucketsRescan").
      success(function() {
          alert("Buckets rescan directory succeeded");
          retrieveBucketNames();
      }).
      error(function(data) {
          alert("Buckets rescan directory failed");
      });
  };

  function retrieveBucketNames() {
    $http.get('/_api/buckets').
      success(function(data) {
        $scope.names = data.sort();
        $scope.err = null;
      }).error(function() {
          $scope.err = restErrorMsg;
      });
  }

  retrieveBucketNames();
}

function BucketCtrl($scope, $routeParams, $http, $location) {
  $scope.bucketName = $routeParams.bucketName;

  $scope.flushBucketDirtyItems = function() {
    $http.post("/_api/buckets/" + $scope.bucketName + "/flushDirty").
      success(function() {
          alert("Dirty items for bucket '" + $scope.bucketName +
                "' were flushed to disk.");
      }).
      error(function(data) {
          alert("Dirty items for bucket '" + $scope.bucketName +
                "' were not flushed to disk; error: " + data);
      });
  };

  $scope.compactBucket = function() {
    $http.post("/_api/buckets/" + $scope.bucketName + "/compact").
      success(function() {
          alert("Bucket '" + $scope.bucketName +
                "' was compacted.");
      }).
      error(function(data) {
          alert("Bucket '" + $scope.bucketName +
                "' was not compacted; error: " + data);
      });
  };

  $scope.deleteBucket = function() {
    if (confirm("Are you sure you want to permanently delete bucket '" +
                $scope.bucketName +
                "', including erasing all its data items?")) {
      $http.delete("/_api/buckets/" + $scope.bucketName).
        success(function() {
            $location.path("/buckets");
            $scope.$apply();
        }).
        error(function(data) {
            alert("Bucket '" + $scope.bucketName +
                  "' was not deleted; error: " + data);
        });
    }
  };

  $http.get('/_api/buckets/' + $scope.bucketName).
    success(function(data) {
      $scope.bucket = data;
      $scope.bucket.partitionsArray = _.values(data.partitions);
      $scope.err = null;
    }).
    error(function() {
        $scope.err = restErrorMsg;
    });

  $scope.orderChoice = 'id';
}

var lastChartId = (new Date()).getTime();

function BucketStatsCtrl($scope, $routeParams, $http, $timeout) {
  $scope.bucketName = $routeParams.bucketName;
  $scope.currLevel = 0;
  $scope.currStatKind = "bucketStats";
  $scope.currStatName = "ops";
  $scope.paused = false;

  $scope.stopChart = function() {
    if ($scope.drawChart) {
      $scope.drawChart(null);
      $scope.drawChart = null;
    }
    if ($scope.timeout) {
      $timeout.cancel($scope.timeout);
      $scope.timeout = null;
    }
  };

  $scope.changeLevel = function(i) {
    $scope.stopChart();
    $scope.currLevel = i;
    $scope.paused = false;
    go();
  };

  $scope.changeStat = function(kind, statName) {
    $scope.stopChart();
    $scope.currStatKind = kind;
    $scope.currStatName = statName;
    $scope.paused = false;
    go();
  };

  function go() {
    if ($scope.paused) {
        $scope.timeout = $timeout(go, 1000);
        return;
    }

    $http.get('/_api/buckets/' + $scope.bucketName + '/stats').
      success(function(data) {
        $scope.err = null;
        $scope.stats = data;
        $scope.statNames =
          _.union(_.map(_.without(_.keys(data.totals.bucketStats), "time"),
                        function(x) { return ["bucketStats", x]; }),
                  _.map(_.without(_.keys(data.totals.bucketStoreStats), "time"),
                        function(x) { return ["bucketStoreStats", x]; }));

        if (!$scope.drawChart) {
          lastChartId++;
          $scope.drawChart =
            makeChart("bucketCharts", lastChartId,
                      $scope.currStatName,
                      data.levels[$scope.currLevel].numSamples,
                      10, 400);
        }
        $scope.drawChart(data.diffs[$scope.currStatKind].levels[$scope.currLevel]);
        $scope.timeout = $timeout(go, 1000);
      }).
      error(function() {
        $scope.err = restErrorMsg;
        $scope.timeout = $timeout(go, 1000);
      });
  }

  go();
}

function makeChart(containerId, chartId, statName, dataLength, barW, barH) {
  var duration = 400;
  var xMargin = 0.5;
  var yMargin = 0.5;
  var done = false;

  var xScale = d3.scale.linear()
    .domain([0, 1])
    .range([0, barW]);

  return function(data) {
    if (!data || lastChartId != chartId) {
      done = true;
      d3.select("#chart" + chartId)
        .selectAll("rect")
        .data([])
        .exit()
        .remove();
      d3.select("#chart" + chartId)
        .remove();
    }
    if (done) {
      return;
    }

    function idx(i) {
      // Handles when data length is too small.
      if (dataLength > data.length) {
        return i + dataLength - data.length;
      }
      return i;
    }

    var yMin = 0xffffffff;
    var yMax = 0;
    for (var i = 0; i < data.length; i++) {
      if (yMin > data[i][statName]) {
        yMin = data[i][statName];
      }
      if (yMax < data[i][statName]) {
        yMax = data[i][statName];
      }
    }
    if (yMax - yMin < barH) {
      yMax = yMin + barH;
    }

    var yScale = d3.scale.linear()
      .domain([yMin, yMax])
      .rangeRound([2, barH]);

    if (!document.getElementById("chart" + chartId)) {
      d3.select("#" + containerId)
        .append("svg:svg")
        .attr("id", "chart" + chartId)
        .attr("class", "chart")
        .attr("width", barW * dataLength - 1)
        .attr("height", barH);
    }

    var chart = d3.select("#chart" + chartId);

    var rect = chart.selectAll("rect")
          .data(data, function(d) { return d.time; });

    rect.enter()
      .insert("rect")
      .attr("x", function(d, i) { return xScale(idx(i + 1)) - xMargin; })
      .attr("y", function(d) {
          return barH - yScale(d[statName]) - yMargin;
        })
      .attr("width", barW)
      .attr("height", function(d) { return yMin + yScale(d[statName]); })
      .transition().duration(duration)
      .attr("x", function(d, i) { return xScale(idx(i)) - xMargin; });

    rect.transition().duration(duration)
      .attr("x", function(d, i) { return xScale(idx(i)) - xMargin; })
      .attr("y", function(d) {
          return barH - yScale(d[statName]) - yMargin;
        })
      .attr("height", function(d) { return yMin + yScale(d[statName]); });

    rect.exit()
      .transition().duration(duration)
      .attr("x", function(d, i) { return -barW - xMargin; })
      .remove();
  };
}

function BucketDDocsCtrl($scope, $routeParams, $http) {
  $scope.bucketName = $routeParams.bucketName;

  $scope.suffix = function(s) {
    var a = s.split('/');
    return a[a.length - 1];
  };

  $scope.ddocCreate = function() {
    var ddocName = $scope.ddocName;
    if (!ddocName || ddocName.length <= 0) {
        return;
    }
    if (!ddocName.match(ddocNamePattern)) {
      $scope.ddocCreateResult =
        "error: please use alphanumerics, slashes, dashes, and underscores only" +
        " for design doc name";
        return;
    }
    if (ddocName.length <= "_design/".length) {
      $scope.ddocCreateResult = "error: design doc name is too short";
        return;
    }
    if (ddocName.search("_design/") != 0) {
      $scope.ddocCreateResult =
        "error: please start your design doc name with _design/";
        return;
    }

    var viewName = $scope.viewName;
    if (viewName.length <= 0) {
        return;
    }
    if (!viewName.match(viewNamePattern)) {
      $scope.ddocCreateResult =
        "error: please use alphanumerics, dashes, and underscores only" +
        " for view name";
        return;
    }
    if (viewName.length <= 0) {
      $scope.ddocCreateResult = "error: missing view name";
        return;
    }

    $scope.ddocCreateResult = "creating design doc: " + ddocName + " ...";
    ddoc = {
      "id": ddocName,
      "views": {}
    };
    ddoc.views[viewName] = {
      "map": "function (doc, meta) {\n  emit(meta.id, null);\n}"
    };
    $http({
        method: 'PUT',
        url: '/couchBase/' + $scope.bucketName + '/' + ddocName,
        data: ddoc
      }).
      success(function(data) {
        $scope.ddocCreateResult = "created design doc: " + ddocName;
        retrieveDDocs();
      }).
      error(function(data) {
        $scope.ddocCreateResult =
          "error creating design doc: " + ddocName + "; error: " + data;
      });
  };

  function retrieveDDocs() {
    $http.get('/pools/default/buckets/' + $scope.bucketName + '/ddocs').
      success(function(data) {
          $scope.ddocs = data;
          $scope.err = null;
        }).
      error(function() {
          $scope.err = restErrorMsg;
      });
  }

  retrieveDDocs();
}

function BucketDDocCtrl($scope, $routeParams, $http) {
  $scope.bucketName = $routeParams.bucketName;
  $scope.ddocNameSuffix = $routeParams.ddocNameSuffix;
  $scope.ddocName = "_design/" + $routeParams.ddocNameSuffix;

  // Added in order to compose View Results URL for now, TODO: make it better, with params
  $scope.viewUrlHost = location.hostname;
  $scope.viewUrlPort = 8092;

  $scope.viewCreate = function() {
    var viewName = $scope.viewName;
    if (!viewName || viewName.length <= 0) {
        return;
    }
    if (!viewName.match(viewNamePattern)) {
      $scope.viewCreateResult =
        "error: please use alphanumerics, dashes, and underscores only" +
        " for view name";
        return;
    }
    if (viewName.length <= 0) {
      $scope.viewCreateResult = "error: missing view name";
        return;
    }

    ddoc = $scope.ddoc;
    if (!ddoc) {
      $scope.viewCreateResult = "error: missing existing ddoc";
        return;
    }
    if (!ddoc.views) {
      ddoc.views = {};
    }
    if (ddoc.views[viewName]) {
      $scope.viewCreateResult = "error: view of the same name already exists";
        return;
    }
    ddoc.views[viewName] = {
      "map": "function (doc, meta) {\n  emit(meta.id, null);\n}"
    };

    $scope.viewCreateResult = "adding view: " + viewName + " ...";
    ddocSaveActual(ddoc, "viewCreateResult",
                   "added view: " + viewName + " to: " + $scope.ddocName,
                   "error saving design doc: " + $scope.ddocName);
  };

  $scope.ddocSave = function() {
    var dirty = false;

    ddoc = $scope.ddoc;
    if (!ddoc.views) {
      ddoc.views = {};
    }
    for (var viewName in ddoc.views) {
      console.log(viewName);
      var tid = $scope.bucketName + "/" + $scope.ddocName + "/" + viewName;
      _.each(["map", "reduce"], function(kind) {
          var prev = ddoc.views[viewName][kind] || "";
          var curr = document.getElementById(tid + "-" + kind).value;
          if (curr != prev) {
            ddoc.views[viewName][kind] = curr;
            dirty = true;
          }
      });
    }

    if (dirty) {
      $scope.ddocSaveResult = "saving design doc: " + $scope.ddocName + " ...";
      ddocSaveActual(ddoc, "ddocSaveResult",
                     "saved design doc: " + $scope.ddocName,
                     "error saving design doc: " + $scope.ddocName);

    }
  };

  function ddocSaveActual(ddoc, msgName, msgSuccess, msgError) {
    $http({
        method: 'PUT',
        url: '/couchBase/' + $scope.bucketName + '/' + $scope.ddocName,
        data: ddoc
      }).
      success(function(data) {
        $scope[msgName] = msgSuccess;
        retrieveDDoc();
      }).
      error(function(data) {
        $scope[msgName] = msgError + "; error: " + data;
      });
  }

  function retrieveDDoc() {
    $http.get('/couchBase/' + $scope.bucketName + '/' + $scope.ddocName).
      success(function(data) {
          $scope.ddoc = data;
          $scope.err = null;
        }).
      error(function() {
          $scope.err = restErrorMsg;
      });
  }

  retrieveDDoc();
}
