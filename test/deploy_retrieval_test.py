"""Offline retrieval rollout archive boundaries."""
import importlib.util
import io
from pathlib import Path
import unittest
import zipfile
spec=importlib.util.spec_from_file_location('retrieval_deploy',Path(__file__).resolve().parents[1]/'scripts/deploy-episode-retrieval.py')
deploy=importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class Deployment(unittest.TestCase):
    def archive(self,missing=None):
        data=io.BytesIO()
        with zipfile.ZipFile(data,'w') as z:
            for name in (*deploy.REPLACE,'dist/src/channelPlanner.js','node_modules/retained/index.js'):
                if name!=missing:z.writestr(name,'old-'+name)
        return data.getvalue()

    def test_preserves_dependencies_and_personas(self):
        original=self.archive()
        updated=deploy.patch(original,{name:b'new' for name in deploy.REPLACE},b'bundled-sdk')
        before=zipfile.ZipFile(io.BytesIO(original));after=zipfile.ZipFile(io.BytesIO(updated))
        self.assertEqual(set(after.namelist()),set(before.namelist())|{deploy.ADAPTER})
        for name in before.namelist():self.assertEqual(after.read(name),b'new' if name in deploy.REPLACE else before.read(name))
        self.assertEqual(after.read('dist/src/episodeRetrieval.js'),b'bundled-sdk')

    def test_rejects_wrong_preimage_or_extra_replacements(self):
        for name in deploy.REPLACE:
            with self.assertRaises(RuntimeError):deploy.patch(self.archive(name),{x:b'new' for x in deploy.REPLACE},b'new')
        with self.assertRaises(RuntimeError):deploy.patch(self.archive(),{'node_modules/unsafe.js':b'new'},b'new')


if __name__=='__main__':unittest.main()
