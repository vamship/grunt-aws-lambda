'use strict';

/*
 * grunt-aws-lambda
 * https://github.com/Tim-B/grunt-aws-lambda
 *
 * Copyright (c) 2014 Tim-B
 * Licensed under the MIT license.
 */

/*
 ======== A Handy Little Nodeunit Reference ========
 https://github.com/caolan/nodeunit

 Test methods:
 test.expect(numAssertions)
 test.done()
 Test assertions:
 test.ok(value, [message])
 test.equal(actual, expected, [message])
 test.notEqual(actual, expected, [message])
 test.deepEqual(actual, expected, [message])
 test.notDeepEqual(actual, expected, [message])
 test.strictEqual(actual, expected, [message])
 test.notStrictEqual(actual, expected, [message])
 test.throws(block, [error], [message])
 test.doesNotThrow(block, [error], [message])
 test.ifError(value)
 */

var mockery = require('mockery');
var path = require('path');
var sinon = require('sinon');

mockery.registerAllowable('../../utils/invoke_task');
var gruntMock = require('../utils/grunt_mock');
var fsMock = require('../utils/fs_mock');

var deployTaskTest = {};

var awsSDKMock,
    lambdaAPIMock,
    defaultGruntConfig,
    proxyAgentMock;

deployTaskTest.setUp = function(done) {
    mockery.enable({
        warnOnReplace: false,
        warnOnUnregistered: false,
        useCleanCache: true
    });

    lambdaAPIMock = {
        getFunction: sinon.stub().callsArgWithAsync(1, null, {
            data: {
                Configuration: {
                    timeout: 100,
                    MemorySize: 128,
                    Handler: 'handler'
                }
            }
        }),
        updateFunctionConfiguration: sinon.stub().callsArgWithAsync(1, null, {}),
        updateFunctionCode: sinon.stub().callsArgWithAsync(1, null, {}),
        publishVersion: sinon.stub().callsArgWithAsync(1, null, {
            Version: 5
        }),
        getAlias: sinon.stub().callsArgWithAsync(1, {statusCode: 404}, {}),
        createAlias: sinon.stub().callsArgWithAsync(1, null, {}),
        updateAlias: sinon.stub().callsArgWithAsync(1, null, {})
    };

    awsSDKMock = {
        SharedIniFileCredentials: sinon.stub(),
        EC2MetadataCredentials: sinon.stub(),
        TemporaryCredentials: sinon.stub(),
        config: {
            update: sinon.stub(),
            loadFromPath: sinon.stub()
        },
        Lambda: function(params) {
            return lambdaAPIMock;
        }
    };
    
    proxyAgentMock = sinon.spy();

    fsMock.reset();
    mockery.registerMock('fs', fsMock);

    fsMock.setFileContent('some-package.zip', 'abc123');

    mockery.registerMock('aws-sdk', awsSDKMock);
    
    mockery.registerMock('proxy-agent', proxyAgentMock);

    var dateFacadeMock = {
        getHumanReadableTimestamp: sinon.stub().returns('Sat Feb 13 2016 21:46:15 GMT-0800 (PST)')
    };
    mockery.registerMock('./date_facade', dateFacadeMock);

    defaultGruntConfig = {
        'lambda_deploy.fake-target.function': 'some-function',
        'lambda_deploy.fake-target.package': './dist/some-package.zip'
    };

    delete process.env.https_proxy;

    done();
};

deployTaskTest.tearDown = function(done) {
    mockery.disable();
    done();
};

deployTaskTest.testDeploySucceed = function(test) {
    test.expect(9);

    var deployTask = require('../../utils/deploy_task');

    var harnessParams = {
        options: {},
        config: defaultGruntConfig,
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 3);
            test.equal(harness.output[0], 'Uploading...');
            test.equal(harness.output[1], 'Package deployed.');
            test.equal(harness.output[2], 'No config updates to make.');

            test.ok(awsSDKMock.config.update.calledWith({region: 'us-east-1'}));
            test.ok(lambdaAPIMock.getFunction.calledWith({FunctionName: 'some-function'}));
            test.ok(lambdaAPIMock.updateFunctionCode.calledWith({FunctionName: 'some-function', ZipFile: 'abc123'}));
            test.ok(!lambdaAPIMock.updateFunctionConfiguration.called);
            test.done();
        }
    };
    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testDeployUsingProxy = function(test) {
    test.expect(6);

    var deployTask = require('../../utils/deploy_task');

    var proxy = 'http://localhost:8080';
    process.env.https_proxy = proxy;

    var harnessParams = {
        options: {},
        config: defaultGruntConfig,
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 3);
            test.equal(harness.output[0], 'Uploading...');
            test.equal(harness.output[1], 'Package deployed.');
            test.equal(harness.output[2], 'No config updates to make.');

            test.ok(proxyAgentMock.calledWith(proxy));
            test.done();
        }
    };

    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testDeployWithoutProxy = function(test) {
    test.expect(6);

    var deployTask = require('../../utils/deploy_task');

    var harnessParams = {
        options: {},
        config: defaultGruntConfig,
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 3);
            test.equal(harness.output[0], 'Uploading...');
            test.equal(harness.output[1], 'Package deployed.');
            test.equal(harness.output[2], 'No config updates to make.');

            test.ok(!proxyAgentMock.called);
            test.done();
        }
    };

    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testDeployS3 = function(test) {
    test.expect(9);

    var deployTask = require('../../utils/deploy_task');
    var expectedPackage = 'my-package.zip';
    var expectedS3Bucket = 'my-s3-bucket';
    var expectedS3Path = 'my-s3-path';
    var expectedS3Key = expectedS3Path + '/' + expectedPackage;
    var progressMessage = [
        'Using code deployed to S3 at [',
        expectedS3Bucket, '/', expectedS3Key,
        '] (version: LATEST)'
    ].join('');

    var harnessParams = {
        options: { },
        config: {
            'lambda_deploy.fake-target.function': 'some-function',
            'lambda_deploy.fake-target.package': expectedPackage,
            'lambda_deploy.fake-target.s3_bucket': expectedS3Bucket,
            'lambda_deploy.fake-target.s3_path': expectedS3Path
        },
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 3);
            test.equal(harness.output[0], progressMessage);
            test.equal(harness.output[1], 'Package deployed.');
            test.equal(harness.output[2], 'No config updates to make.');

            test.ok(awsSDKMock.config.update.calledWith({region: 'us-east-1'}));
            test.ok(lambdaAPIMock.getFunction.calledWith({FunctionName: 'some-function'}));
            test.ok(lambdaAPIMock.updateFunctionCode.calledWith({
                FunctionName: 'some-function',
                S3Bucket: expectedS3Bucket,
                S3Key: expectedS3Key
            }));
            test.ok(!lambdaAPIMock.updateFunctionConfiguration.called);
            test.done();
        }
    };
    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testDeployS3WithoutPath = function(test) {
    test.expect(9);

    var deployTask = require('../../utils/deploy_task');
    var expectedPackage = 'my-package.zip';
    var expectedS3Bucket = 'my-s3-bucket';
    var expectedS3Path = '';
    var expectedS3Key = expectedPackage;
    var progressMessage = [
        'Using code deployed to S3 at [',
        expectedS3Bucket, '/', expectedPackage,
        '] (version: LATEST)'
    ].join('');

    var harnessParams = {
        options: { },
        config: {
            'lambda_deploy.fake-target.function': 'some-function',
            'lambda_deploy.fake-target.package': expectedPackage,
            'lambda_deploy.fake-target.s3_bucket': expectedS3Bucket,
            'lambda_deploy.fake-target.s3_path': expectedS3Path
        },
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 3);
            test.equal(harness.output[0], progressMessage);
            test.equal(harness.output[1], 'Package deployed.');
            test.equal(harness.output[2], 'No config updates to make.');

            test.ok(awsSDKMock.config.update.calledWith({region: 'us-east-1'}));
            test.ok(lambdaAPIMock.getFunction.calledWith({FunctionName: 'some-function'}));
            test.ok(lambdaAPIMock.updateFunctionCode.calledWith({
                FunctionName: 'some-function',
                S3Bucket: expectedS3Bucket,
                S3Key: expectedS3Key
            }));
            test.ok(!lambdaAPIMock.updateFunctionConfiguration.called);
            test.done();
        }
    };
    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testDeployS3WithVersion = function(test) {
    test.expect(9);

    var deployTask = require('../../utils/deploy_task');
    var expectedPackage = 'my-package.zip';
    var expectedS3Bucket = 'my-s3-bucket';
    var expectedS3Path = 'my-s3-path';
    var expectedS3Version = 'my-version';
    var expectedS3Key = expectedS3Path + '/' + expectedPackage;
    var progressMessage = [
        'Using code deployed to S3 at [',
        expectedS3Bucket, '/', expectedS3Key,
        '] (version: ',
        expectedS3Version,
        ')'
    ].join('');

    var harnessParams = {
        options: { },
        config: {
            'lambda_deploy.fake-target.function': 'some-function',
            'lambda_deploy.fake-target.package': expectedPackage,
            'lambda_deploy.fake-target.s3_bucket': expectedS3Bucket,
            'lambda_deploy.fake-target.s3_path': expectedS3Path,
            'lambda_deploy.fake-target.s3_version': expectedS3Version
        },
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 3);
            test.equal(harness.output[0], progressMessage);
            test.equal(harness.output[1], 'Package deployed.');
            test.equal(harness.output[2], 'No config updates to make.');

            test.ok(awsSDKMock.config.update.calledWith({region: 'us-east-1'}));
            test.ok(lambdaAPIMock.getFunction.calledWith({FunctionName: 'some-function'}));
            test.ok(lambdaAPIMock.updateFunctionCode.calledWith({
                FunctionName: 'some-function',
                S3Bucket: expectedS3Bucket,
                S3Key: expectedS3Key,
                S3ObjectVersion: expectedS3Version
            }));
            test.ok(!lambdaAPIMock.updateFunctionConfiguration.called);
            test.done();
        }
    };
    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testProfile = function(test) {
    test.expect(3);

    var deployTask = require('../../utils/deploy_task');

    var harnessParams = {
        options: {
            profile: 'some-profile'
        },
        config: defaultGruntConfig,
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 3);

            test.ok(awsSDKMock.SharedIniFileCredentials.calledWith({profile: 'some-profile'}));
            test.done();
        }
    };
    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testRoleArn = function(test) {
    test.expect(3);

    var deployTask = require('../../utils/deploy_task');

    var harnessParams = {
        options: {
            RoleArn: 'arn:some:role'
        },
        config: defaultGruntConfig,
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 3);

            test.ok(awsSDKMock.TemporaryCredentials.calledWith({RoleArn: 'arn:some:role'}));
            test.done();
        }
    };
    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testAccessKeys = function(test) {
    test.expect(3);

    var deployTask = require('../../utils/deploy_task');

    var harnessParams = {
        options: {
            accessKeyId: 'some-access-key',
            secretAccessKey: 'some-secret-access-key'
        },
        config: defaultGruntConfig,
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 3);

            test.ok(awsSDKMock.config.update.calledWith({accessKeyId: 'some-access-key',
                secretAccessKey: 'some-secret-access-key'}));
            test.done();
        }
    };
    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testCredentialsJSON = function(test) {
    test.expect(3);

    var deployTask = require('../../utils/deploy_task');

    var harnessParams = {
        options: {
            credentialsJSON: 'credentials.json'
        },
        config: defaultGruntConfig,
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 3);

            test.ok(awsSDKMock.config.loadFromPath.calledWith('credentials.json'));
            test.done();
        }
    };
    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testRegion = function(test) {
    test.expect(3);

    var deployTask = require('../../utils/deploy_task');

    var harnessParams = {
        options: {
            region: 'mars-north-8'
        },
        config: defaultGruntConfig,
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 3);

            test.ok(awsSDKMock.config.update.calledWith({region: 'mars-north-8'}));
            test.done();
        }
    };
    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testTimeout = function(test) {
    test.expect(4);

    var deployTask = require('../../utils/deploy_task');

    var harnessParams = {
        options: {
            timeout: 3000
        },
        config: defaultGruntConfig,
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 3);
            test.equal(harness.output[2], 'Config updated.');

            test.ok(lambdaAPIMock.updateFunctionConfiguration.calledWithMatch({Timeout: 3000}));
            test.done();
        }
    };
    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testMemorySize = function(test) {
    test.expect(4);

    var deployTask = require('../../utils/deploy_task');

    var harnessParams = {
        options: {
            memory: 1024
        },
        config: defaultGruntConfig,
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 3);
            test.equal(harness.output[2], 'Config updated.');

            test.ok(lambdaAPIMock.updateFunctionConfiguration.calledWithMatch({MemorySize: 1024}));
            test.done();
        }
    };
    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testVpcConfig = function(test) {
    test.expect(4);

    var deployTask = require('../../utils/deploy_task');

    var harnessParams = {
        options: {
            subnetIds: ['subnet-XXXXX'],
            securityGroupIds: ['sg-XXXXXX']
        },
        config: defaultGruntConfig,
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 3);
            test.equal(harness.output[2], 'Config updated.');

            test.ok(lambdaAPIMock.updateFunctionConfiguration.calledWithMatch({VpcConfig: {
              SubnetIds : ['subnet-XXXXX'],
              SecurityGroupIds : ['sg-XXXXXX']
            }}));
            test.done();
        }
    };
    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testHandler = function(test) {
    test.expect(4);

    var deployTask = require('../../utils/deploy_task');

    var harnessParams = {
        options: {
            handler: 'some-handler'
        },
        config: defaultGruntConfig,
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 3);
            test.equal(harness.output[2], 'Config updated.');

            test.ok(lambdaAPIMock.updateFunctionConfiguration.calledWithMatch({Handler: 'some-handler'}));
            test.done();
        }
    };
    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testEnableVersioning = function(test) {
    test.expect(5);

    var deployTask = require('../../utils/deploy_task');

    var harnessParams = {
        options: {
            enableVersioning: true
        },
        config: defaultGruntConfig,
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 4);
            test.equal(harness.output[2], 'No config updates to make.');
            test.equal(harness.output[3], 'Version 5 published.');

            test.ok(lambdaAPIMock.publishVersion.calledWithMatch({FunctionName: 'some-function',
                Description: 'Deployed on Sat Feb 13 2016 21:46:15 GMT-0800 (PST)'}));
            test.done();
        }
    };
    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testNewAlias = function(test) {
    test.expect(6);

    var deployTask = require('../../utils/deploy_task');

    var harnessParams = {
        options: {
            aliases: 'beta'
        },
        config: defaultGruntConfig,
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 4);
            test.equal(harness.output[2], 'No config updates to make.');
            test.equal(harness.output[3], 'Alias beta updated pointing to version $LATEST.');

            test.ok(lambdaAPIMock.createAlias.calledWithMatch({FunctionName: 'some-function', Name: 'beta',
                    FunctionVersion: '$LATEST', Description: 'Deployed on Sat Feb 13 2016 21:46:15 GMT-0800 (PST)'}));
            test.ok(!lambdaAPIMock.updateAlias.called);
            test.done();
        }
    };
    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testUpdatedAlias = function(test) {
    test.expect(6);

    lambdaAPIMock.getAlias = sinon.stub().callsArgWithAsync(1, null, {});

    var deployTask = require('../../utils/deploy_task');

    var harnessParams = {
        options: {
            aliases: 'beta'
        },
        config: defaultGruntConfig,
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 4);
            test.equal(harness.output[2], 'No config updates to make.');
            test.equal(harness.output[3], 'Alias beta updated pointing to version $LATEST.');

            test.ok(lambdaAPIMock.updateAlias.calledWithMatch({FunctionName: 'some-function', Name: 'beta',
                FunctionVersion: '$LATEST', Description: 'Deployed on Sat Feb 13 2016 21:46:15 GMT-0800 (PST)'}));
            test.ok(!lambdaAPIMock.createAlias.called);
            test.done();
        }
    };
    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testAliasAndVersion = function(test) {
    test.expect(6);

    var deployTask = require('../../utils/deploy_task');

    var harnessParams = {
        options: {
            aliases: 'beta',
            enableVersioning: true
        },
        config: defaultGruntConfig,
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 5);
            test.equal(harness.output[2], 'No config updates to make.');
            test.equal(harness.output[3], 'Version 5 published.');
            test.equal(harness.output[4], 'Alias beta updated pointing to version 5.');

            test.ok(lambdaAPIMock.createAlias.calledWithMatch({FunctionName: 'some-function', Name: 'beta',
                FunctionVersion: 5, Description: 'Deployed on Sat Feb 13 2016 21:46:15 GMT-0800 (PST)'}));
            test.done();
        }
    };
    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testEnablePackageVersionAlias = function(test) {
    test.expect(6);

    var deployTask = require('../../utils/deploy_task');

    defaultGruntConfig['lambda_deploy.fake-target.version'] = '1.2.3';

    var harnessParams = {
        options: {
            enablePackageVersionAlias: true
        },
        config: defaultGruntConfig,
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 4);
            test.equal(harness.output[2], 'No config updates to make.');
            test.equal(harness.output[3], 'Alias 1-2-3 updated pointing to version $LATEST.');

            test.ok(lambdaAPIMock.createAlias.calledWithMatch({FunctionName: 'some-function', Name: '1-2-3',
                FunctionVersion: '$LATEST', Description: 'Deployed version 1.2.3 on Sat Feb 13 2016 21:46:15 GMT-0800 (PST)'}));
            test.ok(!lambdaAPIMock.updateAlias.called);
            test.done();
        }
    };
    gruntMock.execute(deployTask.getHandler, harnessParams);
};

deployTaskTest.testMultipleAliases = function(test) {
    test.expect(9);

    var deployTask = require('../../utils/deploy_task');

    var harnessParams = {
        options: {
            aliases: [
                'foo',
                'bar',
                'baz'
            ]
        },
        config: defaultGruntConfig,
        callback: function(harness) {
            test.equal(harness.status, true);
            test.equal(harness.output.length, 6);
            test.equal(harness.output[2], 'No config updates to make.');
            test.equal(harness.output[3], 'Alias foo updated pointing to version $LATEST.');
            test.equal(harness.output[4], 'Alias bar updated pointing to version $LATEST.');
            test.equal(harness.output[5], 'Alias baz updated pointing to version $LATEST.');

            test.ok(lambdaAPIMock.createAlias.calledWithMatch({FunctionName: 'some-function', Name: 'foo',
                FunctionVersion: '$LATEST', Description: 'Deployed on Sat Feb 13 2016 21:46:15 GMT-0800 (PST)'}));
            test.ok(lambdaAPIMock.createAlias.calledWithMatch({FunctionName: 'some-function', Name: 'bar',
                FunctionVersion: '$LATEST', Description: 'Deployed on Sat Feb 13 2016 21:46:15 GMT-0800 (PST)'}));
            test.ok(lambdaAPIMock.createAlias.calledWithMatch({FunctionName: 'some-function', Name: 'baz',
                FunctionVersion: '$LATEST', Description: 'Deployed on Sat Feb 13 2016 21:46:15 GMT-0800 (PST)'}));
            test.done();
        }
    };
    gruntMock.execute(deployTask.getHandler, harnessParams);
};

module.exports = deployTaskTest;
